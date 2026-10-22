import "dotenv/config"
import connectDB from "./config/db.js"
import User from "./models/User.js";
import bcrypt from "bcrypt"
import { randomBytes } from "node:crypto";

async function registerAdmin() {
    try {
        const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
        if (!ADMIN_EMAIL) {
            console.error('Missing ADMIN_EMAIL env variable');
            process.exit(1);
        }
        await connectDB();
        const existingAdmin = await User.findOne({
            email: process.env.ADMIN_EMAIL
        });
        if (existingAdmin) {
            console.log("User already exists as role", existingAdmin.role);
            process.exit(0);
        }
        const temporaryPassword = process.env.ADMIN_PASSWORD || randomBytes(24).toString("base64url");
        if (temporaryPassword.length < 12) {
            throw new Error("ADMIN_PASSWORD must have at least 12 characters");
        }
        const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
        const admin = await User.create({
            email: process.env.ADMIN_EMAIL,
            password: hashedPassword,
            role: "ADMIN",
            mustChangePassword: true,
        })
        console.log("Admin user created");
        console.log("\nemail:", admin.email);
        if (!process.env.ADMIN_PASSWORD) console.log("Temporary password:", temporaryPassword);
        console.log("\nYou must change the temporary password after login.");
        process.exit(0);
    } catch (error) {
        console.error("Seed failed:", error)
        process.exit(1);
    }
}

registerAdmin()
