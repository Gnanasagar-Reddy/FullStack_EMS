import bcrypt from "bcrypt"
import Employee from "../models/Employee.js";
import User from "../models/User.js";
import mongoose from "mongoose";
import { httpError } from "../utils/employeeTransactions.js";

// get employees 
// GET /api/employees
export const getEmployees = async (req, res) => {
    try {
        const { department } = req.query;
        const where = {};
        if (department) where.department = department;
        const employees = await Employee.find(where).sort({ createdAt: -1 }).populate("userId", "email role").lean();
        const result = employees.map((emp) => (
            {
                ...emp,
                id: emp._id.toString(),
                user: emp.userId ? { email: emp.userId.email, role: emp.userId.role } : null,
            }
        ))
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ error: "Failed to fetch employees" });
    }
}

// create employees 
// POST /api/employees
export const createEmployee = async (req, res) => {
    try {
        const { firstName, lastName, email, phone, position,
            department, basicSalary, allowances, deductions, joinDate,
            password, role, bio } = req.body;

        if (!email || typeof password !== "string" || !password || !firstName || !lastName) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        const hashed = await bcrypt.hash(password, 10);
        const user = new User({
            email,
            password: hashed,
            role: role || "EMPLOYEE"
        })

        const employee = new Employee({
            userId: user._id,
            firstName,
            lastName,
            email,
            phone,
            position,
            department: department || "Engineering",
            basicSalary: basicSalary === undefined ? 0 : basicSalary,
            allowances: allowances === undefined ? 0 : allowances,
            deductions: deductions === undefined ? 0 : deductions,
            joinDate: new Date(joinDate),
            bio: bio || "",
        })
        await user.validate();
        await employee.validate();
        await mongoose.connection.transaction(async (dbSession) => {
            await user.save({ session: dbSession });
            await employee.save({ session: dbSession });
        });
        return res.status(201).json({ success: true, employee })

    }
    catch (error) {
        if (error.name === "ValidationError" || error.name === "CastError") {
            return res.status(400).json({ error: "Invalid employee details" });
        }
        if (error.code == 11000) {
            return res.status(400).json({ error: "Email already exists" })
        }
        console.log("Create employee error:", error);
        return res.status(500).json({ error: "Failed to create employee" })
    }
}
// update employees 
// PUT /api/employees/:id
export const updateEmployee = async (req, res) => {
    try {
        const { id } = req.params;
        const { firstName, lastName, email, phone, position,
            department, basicSalary, allowances, deductions, joinDate,
            password, role, bio, employmentStatus } = req.body;

        const employeeUpdate = Object.fromEntries(Object.entries({
            firstName, lastName, email, phone, position, department,
            basicSalary, allowances, deductions, joinDate, employmentStatus, bio,
        }).filter(([, value]) => value !== undefined));
        const userUpdate = {};
        if (email !== undefined) userUpdate.email = email;
        if (role !== undefined) userUpdate.role = role;
        if (password) userUpdate.password = await bcrypt.hash(password, 10);
        await mongoose.connection.transaction(async (dbSession) => {
            const employee = await Employee.findById(id).session(dbSession);
            if (!employee) throw httpError(404, "Employee not found");
            const user = await User.findById(employee.userId).session(dbSession);
            if (!user) throw httpError(404, "Employee account not found");
            const revokeTokens = Boolean(password) || (role !== undefined && role !== user.role);
            employee.set(employeeUpdate);
            user.set(userUpdate);
            if (revokeTokens) user.tokenVersion = (user.tokenVersion || 0) + 1;
            await employee.validate();
            await user.validate();
            await employee.save({ session: dbSession });
            if (Object.keys(userUpdate).length) await user.save({ session: dbSession });
        });

        return res.json({ success: true })

    }
    catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        if (error.name === "ValidationError" || error.name === "CastError") {
            return res.status(400).json({ error: "Invalid employee details" });
        }
        if (error.code == 11000) {
            return res.status(400).json({ error: "Email already exists" })
        }
        return res.status(500).json({ error: "Failed to update employee" })
    }
}
// delete employees 
// DELETE /api/employees/:id
export const deleteEmployee = async (req, res) => {
    try {
        const { id } = req.params;
        const employee = await Employee.findById(id);
        if (!employee) {  
            return res.status(404).json({
                error: "Employee not found"
            });
        }
        employee.isDeleted = true;
        employee.employmentStatus = "INACTIVE";
        await employee.save();
        return res.json({
            success: true
        });
    } catch (error) {
        return res.status(500).json({
            error: "Failed to delete employee"
        });
    }
}
