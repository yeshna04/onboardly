import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AdminLayout } from "./layouts/AdminLayout";
import { PortalLayout } from "./layouts/PortalLayout";
import { AuthProvider, useAuth } from "./lib/auth";
import { useTheme } from "./lib/theme";
import { PageSkeleton } from "./components/ui";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import Invite from "./pages/auth/Invite";

const Dashboard = lazy(() => import("./pages/admin/Dashboard"));
const Enrolments = lazy(() => import("./pages/admin/Enrolments"));
const EnrolmentDetail = lazy(() => import("./pages/admin/EnrolmentDetail"));
const Verification = lazy(() => import("./pages/admin/Verification"));
const Reviews = lazy(() => import("./pages/admin/Reviews"));
const Inbox = lazy(() => import("./pages/admin/Inbox"));
const Customers = lazy(() => import("./pages/admin/Customers"));
const Programmes = lazy(() => import("./pages/admin/Programmes"));
const Trace = lazy(() => import("./pages/admin/Trace"));
const PortalHome = lazy(() => import("./pages/portal/Home"));
const PortalEnrolment = lazy(() => import("./pages/portal/EnrolmentChecklist"));
const PortalMessages = lazy(() => import("./pages/portal/Messages"));
const PortalCatalogue = lazy(() => import("./pages/portal/Catalogue"));

function RequireRole({ role, children }: { role: "admin" | "customer"; children: ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <div className="p-10"><PageSkeleton /></div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (user.role !== role) return <Navigate to={user.role === "admin" ? "/admin" : "/portal"} replace />;
  return <>{children}</>;
}

function Home() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return <Navigate to={!user ? "/login" : user.role === "admin" ? "/admin" : "/portal"} replace />;
}

function ThemedToaster() {
  const { dark } = useTheme();
  return <Toaster position="top-right" richColors closeButton theme={dark ? "dark" : "light"} toastOptions={{ className: "!rounded-xl" }} />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ThemedToaster />
        <Suspense fallback={<div className="p-10"><PageSkeleton /></div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/invite/:code" element={<Invite />} />
            <Route path="/admin" element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
              <Route index element={<Dashboard />} />
              <Route path="enrolments" element={<Enrolments />} />
              <Route path="enrolments/:id" element={<EnrolmentDetail />} />
              <Route path="enrolments/:id/trace" element={<Trace />} />
              <Route path="verification" element={<Verification />} />
              <Route path="reviews" element={<Reviews />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="customers" element={<Customers />} />
              <Route path="programmes" element={<Programmes />} />
            </Route>
            <Route path="/portal" element={<RequireRole role="customer"><PortalLayout /></RequireRole>}>
              <Route index element={<PortalHome />} />
              <Route path="enrolments/:id" element={<PortalEnrolment />} />
              <Route path="messages" element={<PortalMessages />} />
              <Route path="programmes" element={<PortalCatalogue />} />
            </Route>
            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
