import "dotenv/config"
import connectDB from "./config/db.js";
import app from "./app.js";

const port=process.env.PORT || 4000;

await connectDB();

app.listen(port, () => {
    console.log(`server is started at port ${port}`);
});
