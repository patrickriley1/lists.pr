import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authToken, setAuthToken] = useState(
    () => localStorage.getItem("app_auth_token") || ""
  );
  const [authUser, setAuthUser] = useState(() => {
    try {
      const saved = localStorage.getItem("app_auth_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const canUseApp = Boolean(authToken);

  useEffect(() => {
    if (!authToken) return;
    apiFetch("/api/auth/me", { token: authToken })
      .then((data) => {
        setAuthUser(data);
        localStorage.setItem("app_auth_user", JSON.stringify(data));
      })
      .catch(() => {
        clearAuth();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  function persistAuth(token, user) {
    setAuthToken(token);
    setAuthUser(user);
    localStorage.setItem("app_auth_token", token);
    localStorage.setItem("app_auth_user", JSON.stringify(user));
  }

  function clearAuth() {
    setAuthToken("");
    setAuthUser(null);
    localStorage.removeItem("app_auth_token");
    localStorage.removeItem("app_auth_user");
  }

  function logout() {
    clearAuth();
  }

  async function login(username, password) {
    const data = await apiFetch("/api/auth/login", {
      method: "POST",
      body: { username, password },
    });
    persistAuth(data.token, data.user);
    return data;
  }

  async function register(username, email, password) {
    const data = await apiFetch("/api/auth/register", {
      method: "POST",
      body: { username, email, password },
    });
    persistAuth(data.token, data.user);
    return data;
  }

  function updateAuthUser(userData) {
    setAuthUser(userData);
    localStorage.setItem("app_auth_user", JSON.stringify(userData));
  }

  return (
    <AuthContext.Provider
      value={{ authToken, authUser, canUseApp, login, register, logout, updateAuthUser, clearAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
