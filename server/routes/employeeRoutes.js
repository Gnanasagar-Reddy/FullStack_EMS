import { Router } from "express";
import { createEmployee, deleteEmployee, getEmployees, updateEmployee } from "../controllers/employeeController";
import { protect, protectAdmin } from "../middleware/auth";

const employeesRouter = Router();
employeesRouter.get("/", protect ,protectAdmin , getEmployees);
employeesRouter.Post("/", protect ,protectAdmin ,createEmployee);
employeesRouter.put("/:id",protect ,protectAdmin ,updateEmployee);
employeesRouter.delete("/:id", protect ,protectAdmin ,deleteEmployee);


export default employeesRouter