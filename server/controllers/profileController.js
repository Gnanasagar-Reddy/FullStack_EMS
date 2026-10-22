import Employee from "../models/Employee.js";
import User from "../models/User.js";

//get profile
//GET /api/profile

export const getProfile = async (req, res) => {
    try {
        const session = req.session;
        const employee =
            await Employee.findOne({
                userId: session.userId
            });
        if (!employee) {
            if (session.role !== "ADMIN") return res.status(404).json({ error: "Employee not found" });
            const admin = await User.findById(session.userId).select("email bio");
            if (!admin) return res.status(404).json({ error: "User not found" });
            return res.json({
                firstName: "Admin",
                lastName: "",
                email: admin.email,
                position: "Administrator",
                bio: admin.bio || "",
            });
        }
        return res.json(employee)
    } catch (error) {
        return res.status(500).json({ error: "Failed to fetch profile" })
    }
}

//update profile
//PUT /api/profile

export const updateProfile = async (req, res) => {
    try {
        const session = req.session;
        if (typeof req.body.bio !== "string") {
            return res.status(400).json({ error: "Bio must be text" });
        }
        const employee = await Employee.findOne({ userId: session.userId });
        if (!employee) {
            if (session.role !== "ADMIN") return res.status(404).json({ error: "Employee not found" });
            const admin = await User.findByIdAndUpdate(session.userId, { bio: req.body.bio }, { runValidators: true });
            if (!admin) return res.status(404).json({ error: "User not found" });
            return res.json({ success: true });
        }
        if (employee.isDeleted) {
            return res.status(403).json({ error: "Your account is deactivated. You cannot update your profile." });
        }
        await Employee.findByIdAndUpdate(employee._id, {
            bio: req.body.bio
        });
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({error:"Failed to update profile"})
    }
}
