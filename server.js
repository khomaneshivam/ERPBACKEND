import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import authRoutes from "./Routes/AuthRoutes.js"
import { auth } from "./Auth Middleware/auth.js"
import salesRoutes from "./Routes/sale.js"
import masterRoutes from "./Routes/MasterRoutes.js"
import billRoutes from "./Routes/bill.js";
import expenseRoutes from "./Routes/expense.js";
import purchaseRoutes from "./Routes/purchase.js";
import paymentRoutes from "./Routes/payments.js"
import reportsRoutes from "./Routes/reportsRoutes.js"
import machineryRoutes from "./Routes/machineryRoutes.js"
import bankRoutes from "./Routes/bankRoutes.js";
import directorLoanRoutes from "./Routes/directorLoanRoutes.js";
import balanceRoutes from "./Routes/balanceRoutes.js";
import cashRoutes from "./Routes/cashRoutes.js";
import incomeRoutes from "./Routes/income.js";
import reportsRouter from "./Routes/dailyreportRoutes.js";


const app = express();
dotenv.config();
app.use(cors());
app.use(express.json());

app.use("/api/master", auth, masterRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/expense", auth, expenseRoutes);
app.use("/api/bill", auth, billRoutes);
app.use("/api/sales", auth ,salesRoutes);
app.use("/api/purchase",auth , purchaseRoutes);
app.use("/api/payments",auth,   paymentRoutes);
app.use("/api/reports", auth , reportsRoutes)
app.use("/api/machine",auth , machineryRoutes)
app.use("/api/bank", auth ,bankRoutes);
app.use("/api/director-loan", auth ,directorLoanRoutes);
app.use("/api/balance",auth, balanceRoutes);
app.use("/api/cash",auth, cashRoutes);
app.use("/api/reports",auth, reportsRouter);
app.use("/api/income",auth, incomeRoutes);
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
