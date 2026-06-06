import {Toaster} from 'react-hot-toast'
import {Navigate, Route,Routes} from 'react-router-dom'
import LoginLanding from './pages/LoginLanding';
import Employees from './pages/Employees';
import PrintPayslip from './pages/PrintPayslip';
import Settings from './pages/Settings';
import Dashboard from './pages/Dashboard';
import Leave from './pages/Leave';
import Attendance from './pages/Attendance';
import Layout from './pages/Layout';
import LoginForm from './components/LoginForm';
import Payslips from './pages/Payslips';
const App = () => {
   return( 
   <>
     <Toaster/>
     <Routes>
         <Route path='/login' element={<LoginLanding />} />
         <Route path='/login/admin' element={<LoginForm role="Admin" title="Admin portal" subtitle="Sign in to manage the organisation" />} />
         <Route path='/login/employee' element={<LoginForm role="Employee" title="Employee portal" subtitle="Sign in to access your account" />} />
         <Route element={<Layout />}>
            <Route path='/dashboard' element={< Dashboard />}/>
            <Route path='/employees' element={< Employees />}/>
            <Route path='/attendance' element={< Attendance />}/>
            <Route path='/leave' element={< Leave />}/>
            <Route path='/payslips' element={< Payslips />}/>
            <Route path='/settings' element={< Settings />}/>
         </Route>
         <Route path='/print/payslips/:id' element={<PrintPayslip />} />
         <Route path='*' element={<Navigate to="/dashboard" replace/>} />
     </Routes>
   </>
)}

export default App;