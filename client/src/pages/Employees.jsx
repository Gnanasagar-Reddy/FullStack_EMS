import { useCallback, useEffect, useRef, useState } from "react";
import { DEPARTMENTS } from "../assets/assets";
import { Plus, Search, X } from "lucide-react";
import EmployeeCard from "../components/EmployeeCard";
import EmployeeForm from "../components/EmployeeForm";
import api from "../api/axios";

const Employees = () => {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadedDept, setLoadedDept] = useState(null);
  const requestId = useRef(null);
  const [search, setSearch] = useState("");
  const [selectedDept, setSelectedDept] = useState("");
  const [editEmployee, setEditEmployee] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const fetchEmployees = useCallback(() => {
    const currentRequest = Symbol();
    requestId.current = currentRequest;
    return api.get("/employees", { params: { department: selectedDept || undefined } })
      .then((res) => {
        if (currentRequest !== requestId.current) return;
        setEmployees(res.data);
        setLoadError("");
      })
      .catch((error) => {
        if (currentRequest !== requestId.current) return;
        setLoadError(error.response?.data?.error || "Failed to load employees. Please try again.");
      })
      .finally(() => {
        if (currentRequest !== requestId.current) return;
        setLoadedDept(selectedDept);
        setLoading(false);
      });
  }, [selectedDept])

  useEffect(() => {
    fetchEmployees();
    return () => { requestId.current = null; };
  }, [fetchEmployees])

  const filtered = employees.filter((emp) => `${emp.firstName} ${emp.lastName} ${emp.position}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div className="">
          <h1 className="page-title">Welcome</h1>
          <p className="page-subtitle">Manage your team members</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2 w-full sm:w-auto justify-center"><Plus size={16} /> Add Employee</button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input placeholder="Search employees..." value={search} className="w-full pl-10" onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select value={selectedDept} onChange={(e) => setSelectedDept(e.target.value)} className="max-w-40">
          <option value="">All Departments</option>
          {DEPARTMENTS.map((deptName) => (
            <option value={deptName} key={deptName}>{deptName}</option>
          ))}
        </select>
      </div>

      {loading || loadedDept !== selectedDept ?
        (
          <div className="flex justify-center p-12">
            <div className="animate-spin h-8 w-8 border-2 border-indigo-600 border-t-transparent rounded-full" />
          </div>
        )
        : loadError ? (
          <div role="alert" className="card p-6 text-center">
            <p className="text-rose-600">{loadError}</p>
            <button onClick={fetchEmployees} className="btn-secondary mt-4">Retry</button>
          </div>
        ) :
        (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
            {filtered.length === 0 ? (
              <p className="col-span-full text-center py-16 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">No employees found</p>
            ) :
              (
                filtered.map((emp) => <EmployeeCard key={emp.id} employee={emp} onDelete={fetchEmployees} onEdit={(e) => setEditEmployee(e)} />)
              )
            }
          </div>
        )}
      {/* create employee model */}
      {showCreateModal && (
        <div className="fixed bg-black/40 backdrop-blur-sm inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setShowCreateModal(false)}>
          <div className="fixed inset-2" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8 animate-fade-in " onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">New Employee</h2>
                <p className="text-sm text-slate-500 mt-0.5">Create a user account and employee profile</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <EmployeeForm onSuccess={() => {
                setShowCreateModal(false);
                fetchEmployees();
              }} onCancel={() => { setShowCreateModal(false) }} />
            </div>
          </div>
        </div>
      )}
      {editEmployee && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/40 backdrop-blur-sm" onClick={() => setEditEmployee(null)}>
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Edit Employee
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Update employee details
                </p>
              </div>
              <button
                onClick={() => setEditEmployee(null)}
                className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <EmployeeForm initialData={editEmployee} onSuccess={() => {
                setEditEmployee(null);
                fetchEmployees();
              }} onCancel={() => { setEditEmployee(null) }} />
            </div>
          </div>
        </div>)}

    </div>
  )
}

export default Employees
