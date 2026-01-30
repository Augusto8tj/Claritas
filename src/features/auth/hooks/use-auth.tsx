// /src/features/auth/hooks/use-auth.tsx
"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
  useMemo,
  useCallback,
} from "react";
import type { User } from "firebase/auth";
import { Loader2 } from "lucide-react";
import { AuthGuard } from "@/features/auth/components/auth-guard";
import { useUser as useFirebaseUser } from "@/firebase";

type AuthContextType = {
  user: User | null;
  loading: boolean;
  updateUser: (user: User | null) => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  updateUser: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { user: firebaseUser, isUserLoading } = useFirebaseUser();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(firebaseUser);
    setLoading(isUserLoading);
  }, [firebaseUser, isUserLoading]);

  const updateUser = useCallback((updatedUser: User | null) => {
    setUser(updatedUser);
  }, []);
  
  const value = useMemo(() => ({ user, loading, updateUser }), [user, loading, updateUser]);

  if (loading) {
     return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      <AuthGuard>
        {children}
      </AuthGuard>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
