import mongoose from "mongoose"
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("mongoose connected");
    } catch (error) {
        console.error("failed to connect",error.message);
        throw error;
    }
}

export default connectDB
