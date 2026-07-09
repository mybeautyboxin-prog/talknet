import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-[#666]">Loading…</div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (roles && !roles.includes(user.role)) {
    // Redirect to their own home based on role
    if (user.role === "platform_owner") return <Navigate to="/platform" replace />;
    if (user.role === "room_admin") return <Navigate to="/admin" replace />;
    return <Navigate to="/room" replace />;
  }
  return children;
}
