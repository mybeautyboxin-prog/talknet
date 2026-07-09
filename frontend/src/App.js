import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider, useAuth } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Landing from "@/pages/Landing";
import LoginPage from "@/pages/LoginPage";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import OwnerDashboard from "@/pages/OwnerDashboard";
import AdminDashboard from "@/pages/AdminDashboard";
import RoomListPage from "@/pages/RoomListPage";
import RoomPage from "@/pages/RoomPage";

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Landing />;
  if (user.role === "platform_owner") return <Navigate to="/platform" replace />;
  if (user.role === "room_admin") return <Navigate to="/admin" replace />;
  return <Navigate to="/rooms" replace />;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: "#FFFFFF",
                border: "1px solid #E8E8E3",
                color: "#111111",
                borderRadius: "6px",
                fontFamily: "'IBM Plex Sans', sans-serif",
              },
            }}
          />
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/platform" element={
              <ProtectedRoute roles={["platform_owner"]}>
                <OwnerDashboard />
              </ProtectedRoute>
            } />
            <Route path="/admin" element={
              <ProtectedRoute roles={["room_admin"]}>
                <AdminDashboard />
              </ProtectedRoute>
            } />
            <Route path="/rooms" element={
              <ProtectedRoute roles={["room_admin", "user"]}>
                <RoomListPage />
              </ProtectedRoute>
            } />
            <Route path="/room" element={
              <ProtectedRoute roles={["room_admin", "user"]}>
                <RoomPage />
              </ProtectedRoute>
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
