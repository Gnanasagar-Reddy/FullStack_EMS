import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Employee from "../models/Employee.js";

export const protect = async (req,res,next) => {
    let session;
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const token = authHeader.split(" ")[1];
        session = jwt.verify(token, process.env.JWT_SECRET)

        if (!session) {
            return res.status(401).json({ error: "Unauthorized" });
        }
    } catch (error) {
        return res.status(401).json({error : "unauthorized"})
    }
    try {
        const user = await User.findById(session.userId).select("email role mustChangePassword tokenVersion");
        if (!user) return res.status(401).json({ error: "Unauthorized" });
        if ((session.tokenVersion || 0) !== (user.tokenVersion || 0)) {
            return res.status(401).json({ error: "Session expired. Please sign in again." });
        }
        const employee = await Employee.findOne({ userId: session.userId });
        if (employee && (employee.isDeleted || employee.employmentStatus === "INACTIVE")) {
            return res.status(401).json({ error: "Your account is deactivated" });
        }
        req.session = { ...session, role: user.role, email: user.email, mustChangePassword: Boolean(user.mustChangePassword) };
        const path = req.originalUrl.split("?")[0].replace(/\/$/, "");
        if (user.mustChangePassword && !["/api/auth/session", "/api/auth/change-password"].includes(path)) {
            return res.status(403).json({ error: "Change your temporary password before continuing", code: "PASSWORD_CHANGE_REQUIRED" });
        }
        return next();
    } catch (error) {
        console.error("Session lookup failed:", error.message);
        return res.status(503).json({ error: "Unable to verify your session. Please try again." });
    }
}

export const protectAdmin = ( req,res,next ) => {
    if(req?.session?.role !== "ADMIN"){
        return res.status(403).json({error : "Admin access requires"})
    }
    next();
}
