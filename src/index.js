import express, { json } from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

//testing
let name = "Backend Engineer";
app.get("/api/hello",(req,res)=>{
    
    res.status(200).json({
        "Message":`Hello :${name}`
    })
})


const PORT = process.env.PORT || 3000;

app.listen(PORT,()=>{
    console.log(`Server is running at http://localhost:${PORT}`)
})