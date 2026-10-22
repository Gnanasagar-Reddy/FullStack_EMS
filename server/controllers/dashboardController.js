import { DEPARTMENTS } from "../constants/departments.js";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import LeaveApplication from "../models/LeaveApplication.js";
import Payslip from "../models/Payslip.js";
import { indiaDay, indiaMonth } from "../utils/attendanceDates.js";

//get dashboard for admin and employee
//GET /api/dashboard

export const getDashboard = async (req, res) => {
    try {
        const session = req.session;
        if (session.role === "ADMIN") {
            const today = indiaDay();
            const [totalEmployees, todayAttendance, pendingLeaves] = await Promise.all([
                Employee.countDocuments({ isDeleted: { $ne: true } }),
                Attendance.countDocuments({
                    date: {
                        $gte: today.start,
                        $lt: today.end,
                    }
                }),
                LeaveApplication.countDocuments({
                    status: "PENDING"
                })
            ])
            return res.json({
                role: "ADMIN",
                totalEmployees,
                totalDepartments: DEPARTMENTS.length,
                todayAttendance,
                pendingLeaves
            });

        } else {
            const employee = await Employee.findOne({
                userId: session.userId,
            }).lean();
            if (!employee) {
                return res.status(404).json({
                    error: "Employee not found"
                });
            }
            const month = indiaMonth();
            const [currentMonthAttendance, pendingLeaves, latestPayslip] = await Promise.all([
                Attendance.countDocuments({
                    employeeId: employee._id,
                    date: {
                        $gte: month.start,
                        $lt: month.end,
                    }
                }),
                LeaveApplication.countDocuments({
                    employeeId: employee._id,
                    status: "PENDING",
                }),

                Payslip.findOne({
                    employeeId: employee._id
                }).sort({
                    createdAt: -1
                }).lean(),
            ]);
            return res.json({
                role: "EMPLOYEE",
                employee: {
                    ...employee,
                    id: employee._id.toString()
                },
                currentMonthAttendance,
                pendingLeaves,
                latestPayslip: latestPayslip
                    ? {
                        ...latestPayslip,
                        id: latestPayslip._id.toString()
                    }
                    : null
            });
        }
    } catch (error) {
        console.error("Dashboard error:", error);
        return res.status(500).json({
            error: "Failed"
        });
    }
};
