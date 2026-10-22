import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CalendarIcon, ChevronRightCircleIcon, DollarSignIcon, FileTextIcon, LayoutGridIcon, Loader2, LogOutIcon, MenuIcon, SettingsIcon, UserIcon, XIcon } from 'lucide-react';
import { useAuth } from '../context/auth.js';
import api from '../api/axios';

const Sidebar = () => {
    const { pathname } = useLocation();
    const [userName, setUserName] = useState('');
    const [mobileMenu, setMobileMenu] = useState({ open: false, pathname });
    const mobileOpen = mobileMenu.open && mobileMenu.pathname === pathname;
    const setMobileOpen = (open) => setMobileMenu({ open, pathname });
    const { user, loading, logout } = useAuth();

    useEffect(() => {
        let active = true;
        api.get("/profile").then(({ data }) => {
            if (active && data.firstName)
                setUserName(`${data.firstName} ${data.lastName || ""}`.trim());
        }).catch(() => {
            if (active) setUserName("");
        });
        return () => { active = false; };
    }, []);
    const role = user?.role;
    const navItems = [
        { name: "Dashboard", href: "/dashboard", icon: LayoutGridIcon },
        role === "ADMIN" ?
            { name: "Employees", href: "/employees", icon: UserIcon } :
            { name: "Attendance", href: "/attendance", icon: CalendarIcon },
        { name: "Leave", href: "/leave", icon: FileTextIcon },
        { name: "Payslips", href: "/payslips", icon: DollarSignIcon },
        { name: "Settings", href: "/settings", icon: SettingsIcon },
    ]

    const handleLogout = () =>{
        logout();
        window.location.href="/login"
    }

    const sidebarContent = (
        <>
            <div className='px-5 pt-6 pb-5 border-b border-white/6'>
                <div className='flex items-center justify-between'>
                    <div className='flex gap-3 items-center'>
                        <UserIcon className='text-white size-7' />
                        <div className=''>
                            <p className='font-semibold sm:text-base text-white tracking-wide'>Employee MS</p>
                            <p className='text-[11px] text-slate-500 font-medium'>Management System</p>
                        </div>
                    </div >
                    {/* close menu for mobile */}
                    <button onClick={() => setMobileOpen(false)} className='lg:hidden text-slate-400 hover:text-white p-1'>
                        <XIcon size={20} />
                    </button>
                </div>
            </div>
            {/* profile card */}
            {userName && (
                <div className='mx-3 mt-4 mb-1 p-3 rounded-lg bg-white/3 border border-white/5'>
                    <div className='flex items-center gap-3'>
                        <div className='w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center ring-1 ring-white/10 shrink-0'>
                            <span className='text-slate-400 text-xs font-semibold'>
                                {userName.charAt(0).toUpperCase()}
                            </span>
                        </div>
                        <div className='min-w-0'>
                            <p className='text-[14px] font-medium text-slate-200 truncate'>{userName}</p>
                            <p className='text-[12px] text-slate-500 truncate'>{role === "ADMIN" ? "Administrator" : "Employee"}</p>
                        </div>
                    </div>
                </div>)}
            {/* section label */}
            <div className='px-5 pt-5 pb-2'>
                <p className='text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500'>Navigation</p>
            </div>
            {/* navigation list */}
            <div className='flex-1 px-3 space-y-0.5 overflow-y-auto'>
                {loading ? (
                    <div className="px-3 py-3 flex items-center gap-2 text-slate-500">
                        <Loader2 className="animate-spin w-4 h-4" />
                        <span className="text-sm">Loading...</span>
                    </div>
                ) :
                    (
                        navItems.map((item) => {
                            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                            return (
                                <Link key={item.name} to={item.href} onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 px-3 py-2.5 rounded-md text-[13px] font-medium transition-all duration-150 relative ${isActive ? "bg-indigo-500/12 text-indigo-300" : "text-slate-300 hover:text-white hover:bg-white/4"}`}>
                                    {isActive && <div className='absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-indigo-500' />}
                                    <item.icon className={`w-[17px] h-[17px] shrink-0 ${isActive ? "text-indigo-300" : "text-slate-400 group-hover:text-slate-300"}`} />
                                    <span className='flex-1'>
                                        {item.name}
                                    </span>
                                    {isActive && <ChevronRightCircleIcon className='w-3.5 h-3.5 ' />}

                                </Link>
                            )
                        })
                    )}
            </div>
            {/* logout */}
            <div className='p-3 border-t border-white/5'>
                <button onClick={handleLogout} className='flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-[13px] font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-500/8 transition-all duration-150'>
                    <LogOutIcon className='w-[17px] h-[17px]' />
                    <span>Log out</span>
                </button>

            </div>

        </>
    )

    return (
        <>
            {/* mobile hamburger btn */}
            <button onClick={() => setMobileOpen(true)} className='lg:hidden fixed top-4 left-4 z-50 p-2 bg-slate-900 text-white rounded-lg shadow-lg border border-white/10'>
                <MenuIcon size={20} />
            </button>
            {/* mobile overlay */}
            {mobileOpen && <div onClick={() => setMobileOpen(false)} className='lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40' />}
            {/* sidebar desktop*/}
            <aside className='hidden lg:flex flex-col h-full w-64 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-white shrink-0 border-r border-white/4'>
                {sidebarContent}
            </aside>
            {/* sidebar mobile */}
            <aside className={`lg:hidden fixed inset-y-0 left-0 w-72 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-white z-50 flex flex-col transform transition-transform duration-300 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
                {sidebarContent}
            </aside>


        </>
    )
}

export default Sidebar
