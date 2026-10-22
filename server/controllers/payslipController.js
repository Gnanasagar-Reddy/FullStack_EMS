import Employee from "../models/Employee.js";
import Payslip from "../models/Payslip.js";
import mongoose from "mongoose";
import { httpError, withEmployeeLock } from "../utils/employeeTransactions.js";
import { moneyInCents } from "../utils/payroll.js";


//create payslips
//POST /api/payslips


export const createPayslip = async (req, res) => {
    try {
        const { employeeId, month, year, basicSalary, allowances, deductions } = req.body;
        const salaryCents = moneyInCents(basicSalary);
        const allowanceCents = moneyInCents(allowances === undefined ? 0 : allowances);
        const deductionCents = moneyInCents(deductions === undefined ? 0 : deductions);
        const numericMonth = typeof month === "string" || typeof month === "number" ? Number(month) : NaN;
        const numericYear = typeof year === "string" || typeof year === "number" ? Number(year) : NaN;
        if (!mongoose.isObjectIdOrHexString(employeeId) || !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12 ||
            !Number.isInteger(numericYear) || numericYear < 1000 || numericYear > 9999 ||
            [salaryCents, allowanceCents, deductionCents].includes(null)) {
            return res.status(400).json({ error: "Provide a valid employee, month, year, and non-negative amounts with at most two decimal places" });
        }
        const netCents = salaryCents + allowanceCents - deductionCents;
        if (!Number.isSafeInteger(salaryCents + allowanceCents) || !Number.isSafeInteger(netCents) || netCents < 0) {
            return res.status(400).json({ error: "Deductions cannot exceed earnings and amounts must be within the supported range" });
        }
        const payslip = await withEmployeeLock(employeeId, async (dbSession, employee) => {
            if (employee.isDeleted || employee.employmentStatus === "INACTIVE") throw httpError(403, "Cannot generate payslips for an inactive employee");
            const existing = await Payslip.findOne({ employeeId, month: numericMonth, year: numericYear }).session(dbSession);
            if (existing) throw httpError(409, "A payslip already exists for this employee and period");
            const [created] = await Payslip.create([{
                employeeId, month: numericMonth, year: numericYear,
                basicSalary: salaryCents / 100, allowances: allowanceCents / 100,
                deductions: deductionCents / 100, netSalary: netCents / 100,
            }], { session: dbSession });
            return created;
        });
        return res.json({ success: true, data: payslip })
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        if (error.code === 11000) return res.status(409).json({ error: "A payslip already exists for this employee and period" });
        if (error.name === "ValidationError" || error.name === "CastError") return res.status(400).json({ error: "Invalid payslip details" });
        return res.status(500).json({ error: "Failed" })
    }
}


//get payslips
//GET /api/payslips

export const getPayslips = async (req, res) => {
    try {
        const session = req.session;
        const isAdmin = session.role === "ADMIN";
        if (isAdmin) {
            const payslips = await Payslip.find()
                .populate("employeeId")
                .sort({ createdAt: -1 });
            const data = payslips.map((p) => {
                const obj = p.toObject();
                return {
                    ...obj,
                    id: obj._id.toString(),
                    employee: obj.employeeId,
                    employeeId: obj.employeeId?._id?.toString(),
                };
            });
            return res.json({ data });
        }
        else {
            const employee = await Employee.findOne({
                userId: session.userId
            });
            if (!employee) {
                return res.status(404).json({
                    error: "Not found"
                });
            }
            const payslips = await Payslip.find({
                employeeId: employee._id
            }).sort({
                createdAt: -1
            });
            return res.json({
                data: payslips
            });
        }
    } catch (error) {
        return res.status(500).json({ error: "Failed" })
    }
}

//get payslips by id
//GET /api/payslips/:id

export const getPayslipById = async (req, res) => {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ error: "Invalid payslip ID" });
        const where = { _id: req.params.id };
        if (req.session.role !== "ADMIN") {
            const employee = await Employee.findOne({ userId: req.session.userId });
            if (!employee) return res.status(404).json({ error: "Not found" });
            where.employeeId = employee._id;
        }
        const payslip = await Payslip.findOne(where).populate("employeeId").lean();
        if(!payslip)return res.status(404).json({error:"Not found"})
        const result={
          ...payslip,
          id:payslip._id.toString(),
          employee:payslip.employeeId,
        } 
        return res.json({result})   
    } catch (error) {
        return res.status(500).json({ error: "Failed" })
    }
}
