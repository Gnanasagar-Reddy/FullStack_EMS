import User from "../models/User.js";
import bcrypt from "bcrypt"
import Employee from "../models/Employee.js";
import { issueSession } from "../utils/sessions.js";

//login for employee and admmin
//POST /api/auth/login

export const login = async (req, res) => {
    try {
        const { email, password, role_type } = req.body;
        if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
            return res.status(400).json({ error: "Email and password required" })
        }
        const portalRole = typeof role_type === "string" ? role_type.toUpperCase() : "";
        if (!["ADMIN", "EMPLOYEE"].includes(portalRole)) {
            return res.status(400).json({ error: "Select a valid login portal" });
        }
        const user = await User.findOne({ email })
        if (!user) {
            return res.status(401).json({ error: "Invalid credentials" })
        }
        if (user.role !== portalRole) {
            return res.status(401).json({ error: `Not authorized as ${portalRole.toLowerCase()}` })
        }
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.status(401).json({ error: "Invalid credentials" })
        }
        const employee = await Employee.findOne({ userId: user._id });
        if (employee && (employee.isDeleted || employee.employmentStatus === "INACTIVE")) {
            return res.status(403).json({ error: "Your account is deactivated" });
        }
        return res.json(issueSession(user));
    } catch (error) {
        console.error("Login error :", error);
        return res.status(500).json({ error: "Login failed" });
    }
}

//get session for employee and admin
// GET /api/auth/session

export const session = (req, res) => {
    const session = req.session;
    return res.json({ user: session })
}

//change password for employee and admin
// POST /api/auth/change-password

export const changePassword = async (req, res) => {
    try {
        const session = req.session;
        const { currentPassword, newPassword } = req.body;
        if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
            return res.status(400).json({ error: "Both passwords are required" })
        }
        const user = await User.findById(session.userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" })
        }
        const isValid = await bcrypt.compare(currentPassword, user.password);
        if(!isValid){
            return res.status(400).json({error:"current password is incorrect"})
        }
        if (newPassword === currentPassword) {
            return res.status(400).json({ error: "Choose a password different from your current password" });
        }
        if (user.mustChangePassword && (typeof newPassword !== "string" || newPassword.length < 12)) {
            return res.status(400).json({ error: "Your new password must have at least 12 characters" });
        }
        const hashed = await bcrypt.hash(newPassword, 10);
        const updated = await User.findOneAndUpdate(
            { _id: session.userId, password: user.password },
            { $set: { password: hashed, mustChangePassword: false }, $inc: { tokenVersion: 1 } },
            { returnDocument: "after", runValidators: true }
        );
        if (!updated) return res.status(409).json({ error: "Password changed elsewhere. Please sign in again." });
        return res.json({ status: true, ...issueSession(updated) });
    } catch (error) { 
        return res.status(500).json({error:"Failed to change password"})
    }
}
