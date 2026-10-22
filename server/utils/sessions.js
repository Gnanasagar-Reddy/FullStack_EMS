import jwt from "jsonwebtoken";

export function issueSession(user) {
    const payload = {
        userId: user._id.toString(), role: user.role, email: user.email,
        mustChangePassword: Boolean(user.mustChangePassword),
        tokenVersion: user.tokenVersion || 0,
    };
    return { user: payload, token: jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" }) };
}
