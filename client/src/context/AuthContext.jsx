import { useCallback, useEffect, useState } from "react";
import api from "../api/axios.js";
import { AuthContext } from "./auth.js";

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem("token"));
    const [loading, setLoading] = useState(true)
    const [sessionError, setSessionError] = useState("");

    const refreshSession = useCallback(() => {
        const storedToken = localStorage.getItem("token");
        const request = storedToken
            ? api.get("/auth/session")
            : Promise.resolve({ data: { user: null } });
        return request.then(({ data }) => {
            setUser(data.user);
            setToken(storedToken);
            setSessionError("");
        }).catch((error) => {
            if (error.response?.status === 401) {
                localStorage.removeItem("token");
                setUser(null);
                setToken(null);
                setSessionError("");
            } else {
                setSessionError(error.response?.data?.error || "Unable to reach the server. Please try again.");
            }
        }).finally(() => setLoading(false));
    }, []);
    useEffect(() => {
        refreshSession()
    }, [refreshSession])

    const login = async (email, password, role_type) => {
        const { data } = await api.post("/auth/login", {
            email,
            password,
            role_type
        });

        localStorage.setItem("token", data.token);
        setToken(data.token);
        setUser(data.user);
        setSessionError("");
        return data.user;
    }

    const logout = async () =>{
        localStorage.removeItem("token")
        setUser(null);
        setToken(null);
        setSessionError("");
    }

    const value = {user , token , loading , sessionError , login , logout , refreshSession };
    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    )
}
