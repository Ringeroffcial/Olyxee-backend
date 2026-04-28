import express, { json } from "express";
import dotenv from "dotenv";

dotenv.config();
import OrdoRoute from '../Routes/OrdoRoute.js';

const app = express();
app.use(express.json());
app.use('/api/ordo', OrdoRoute);

//testing
const PORT = process.env.PORT ;

app.listen(PORT,()=>{
    console.log(`Server is running at http://localhost:${PORT}`)
})