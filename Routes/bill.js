import express from "express";
import { auth } from "../Auth Middleware/auth.js";
import {  getBills, getBillById } from "../controllers/billController.js";

const router = express.Router();

router.post("/", auth,);
router.get("/", auth, getBills);
router.get("/:id", auth, getBillById);

export default router;
