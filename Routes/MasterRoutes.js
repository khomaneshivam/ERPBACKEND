import express from "express";

// Controllers
import {
  addItem, getItems, updateItem, deleteItem,
  addParty, getParties, updateParty, deleteParty,
  addExpense, getExpenses, deleteExpense,
  addBank, getBanks, deleteBank,
  addCompany, getCompanies, updateCompany, deleteCompany
} from "../controllers/masterController.js";

const router = express.Router();

// ITEM
router.post("/item", addItem);
router.get("/item", getItems);
router.put("/item/:id", updateItem);
router.delete("/item/:id", deleteItem);

// PARTY
router.post("/party", addParty);
router.get("/party", getParties);
router.put("/party/:id", updateParty);
router.delete("/party/:id", deleteParty);

// EXPENSE
router.post("/expense", addExpense);
router.get("/expense", getExpenses);
router.delete("/expense/:id", deleteExpense);

// BANK
router.post("/bank", addBank);
router.get("/bank", getBanks);
router.delete("/bank/:id", deleteBank);


// COMPANY
router.post("/company", addCompany);
router.get("/company", getCompanies);
router.put("/company/:id", updateCompany);
router.delete("/company/:id", deleteCompany);

export default router;
