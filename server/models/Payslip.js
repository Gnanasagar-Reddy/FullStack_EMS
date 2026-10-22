import mongoose from "mongoose";

const payslipSchema = new mongoose.Schema({
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    month: { type: Number, required: true, min: 1, max: 12, validate: Number.isInteger },
    year: { type: Number, required: true, min: 1000, max: 9999, validate: Number.isInteger },
    basicSalary: { type: Number, required: true, min: 0, validate: Number.isFinite },
    allowances: { type: Number, default: 0, min: 0, validate: Number.isFinite },
    deductions: { type: Number, default: 0, min: 0, validate: Number.isFinite },
    netSalary: { type: Number, required: true, min: 0, validate: Number.isFinite }
}, { timestamps: true });

const Payslip = mongoose.models.Payslip || mongoose.model(
    "Payslip",
    payslipSchema
);

export default Payslip;
