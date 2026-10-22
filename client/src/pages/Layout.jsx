import { Navigate, Outlet } from "react-router-dom"
import Sidebar from "../components/Sidebar"
import { useAuth } from "../context/auth.js"
import Loading from "../components/Loading.jsx";
import ChangePasswordModal from "../components/ChangePasswordModal.jsx";

const Layout = () => {
  const {user, token, loading, sessionError, refreshSession, logout} = useAuth();
  if(loading)return <Loading/>
  if (!user && token && sessionError) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
      <p role="alert" className="text-rose-600">{sessionError}</p>
      <button onClick={refreshSession} className="btn-primary">Retry connection</button>
      <button onClick={logout} className="btn-secondary">Sign out</button>
    </div>
  );
  if(!user)return <Navigate to="/login"/>
  if (user.mustChangePassword) return (
    <ChangePasswordModal open required onSuccess={refreshSession} onClose={logout} />
  );

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 pt-16 sm:p-6 sm:pt-6 lg:p-8 max-w-400 mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export default Layout
