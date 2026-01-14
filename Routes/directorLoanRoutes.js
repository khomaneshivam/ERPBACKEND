import express from "express";
import {
  addDirectorLoan,
  getDirectorLoans,
  getDirectorUsers,
  getDirectorLoanById,
  updateDirectorLoan,
  deleteDirectorLoan
} from "../controllers/directorLoanController.js";

const router = express.Router();

// CREATE
router.post("/add", addDirectorLoan);

// READ
router.get("/list", getDirectorLoans);
router.get("/directors-list", getDirectorUsers);
router.get("/:id", getDirectorLoanById);     // ✅ EDIT FETCH

// UPDATE
router.put("/:id", updateDirectorLoan);      // ✅ UPDATE

// DELETE (soft or hard – your controller decides)
router.delete("/delete/:id", deleteDirectorLoan); // ✅ DELETE

export default router;
