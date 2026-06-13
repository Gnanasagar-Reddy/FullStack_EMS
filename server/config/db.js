import mongoose from "mongoose"
const connectDB = async () => {
    try {
        mongoose.connection.on("connected",()=>console.log("mongoose connected"));
        await mongoose.connect(process.env.MONGODB_URI);
    } catch (error) {
        console.error("failed to connect",error.message);
    }
}

export default connectDB