"use client";

import React, { useEffect, useState } from "react";

import {
  loginUser,
  logoutUser,
  registerUser,
  subscribeToAuthChanges,
} from "@/lib/firebase";

export const AuthContext = React.createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges((currentUser) => {
      setUser(currentUser);
      setLoading(false);
    }, () => {
      setUser(null);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    user,
    loading,
    loginUser,
    registerUser,
    logoutUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
