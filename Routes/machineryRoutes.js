import express from "express";
import { auth } from "../Auth Middleware/auth.js";
import {
  addMachinery,
  getMachinery,
  deleteMachinery,       // ✅ Added
  addMachineryRecord,
  getMachineryRecord,
  updateMachineryRecord,
  deleteMachineryRecord
} from "../controllers/machineryController.js";

const router = express.Router();

// Machinery Master Routes
router.post("/add", auth, addMachinery);
router.get("/list", auth, getMachinery);
router.delete("/delete/:id", auth, deleteMachinery); // ✅ Added

// Machinery Record Routes
router.post("/record/add", auth, addMachineryRecord);
router.get("/record/list", auth, getMachineryRecord);
router.put("/record/update/:id", auth, updateMachineryRecord);
router.delete("/record/delete/:id", auth, deleteMachineryRecord);

export default router;
