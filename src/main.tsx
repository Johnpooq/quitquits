import React from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useParams,
} from "react-router-dom";
import AppLayout from "./components/AppLayout";
import { ToastProvider } from "./components/ui";
import { hydrateStore, useAppStore } from "./store/useAppStore";
import { aiService } from "./services/ai";
import OnboardingPage from "./pages/Onboarding";
import TodayPage from "./pages/Today";
import ReviewPage from "./pages/Review";
import EventNewPage from "./pages/EventNew";
import EventDetailPage from "./pages/EventDetail";
import { MaterialUploadPage, MaterialDetailPage } from "./pages/Materials";
import { EmergencyPage, EmergencyResultPage } from "./pages/Emergency";
import ReportPage from "./pages/Report";
import ProfilePage from "./pages/Profile";
import NotFoundPage, { RouteErrorPage } from "./pages/NotFound";
import "./index.css";

/** 旧链接兜底：/daily/:id 换算成对应的 /today/:date */
function LegacyDailyRedirect() {
  const { id = "" } = useParams();
  const entry = useAppStore((s) => s.entries.find((e) => e.id === id));
  return <Navigate to={entry ? `/today/${entry.date}` : "/today"} replace />;
}

/** 旧链接兜底：/record/:date → /today/:date */
function LegacyRecordRedirect() {
  const { date = "" } = useParams();
  return <Navigate to={`/today/${date}`} replace />;
}

/** 旧链接兜底：/archive?tab=xxx → /review?tab=xxx（overview / timeline 归到默认视图） */
function LegacyArchiveRedirect() {
  const tab = new URLSearchParams(window.location.search).get("tab");
  const next =
    tab === "events" || tab === "materials" ? `/review?tab=${tab}` : "/review";
  return <Navigate to={next} replace />;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <Navigate to="/today" replace /> },
      { path: "onboarding", element: <OnboardingPage /> },
      // 今天：状态 + 工作记录 + AI 对话 + 结构化整理，原首页与每日记录合并在这里
      { path: "today", element: <TodayPage /> },
      { path: "today/:date", element: <TodayPage /> },
      // 回顾：承接原职场档案，默认是日历 + 近期记录 + 重要事件
      { path: "review", element: <ReviewPage /> },
      { path: "events/new", element: <EventNewPage /> },
      { path: "events/:id", element: <EventDetailPage /> },
      { path: "materials/upload", element: <MaterialUploadPage /> },
      { path: "materials/:id", element: <MaterialDetailPage /> },
      { path: "emergency", element: <EmergencyPage /> },
      { path: "emergency/result/:id", element: <EmergencyResultPage /> },
      { path: "report", element: <ReportPage /> },
      { path: "profile", element: <ProfilePage /> },
      // 已下线的页面，保留跳转避免旧链接 404
      { path: "home", element: <Navigate to="/today" replace /> },
      { path: "record", element: <Navigate to="/today" replace /> },
      { path: "record/:date", element: <LegacyRecordRedirect /> },
      { path: "archive", element: <LegacyArchiveRedirect /> },
      { path: "mood-calendar", element: <Navigate to="/review" replace /> },
      { path: "check-in", element: <Navigate to="/today" replace /> },
      { path: "assistant", element: <Navigate to="/today" replace /> },
      { path: "daily/:id", element: <LegacyDailyRedirect /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

const root = createRoot(document.getElementById("root")!);

/** 启动画面：数据来自后端数据库，载入完成前不渲染页面，避免用空数据覆盖 */
function Boot({ error }: { error?: string }) {
  return (
    <main className="page stack" role={error ? "alert" : "status"}>
      <p className="muted">{error ?? "正在载入你的记录…"}</p>
      {error && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          重试
        </button>
      )}
    </main>
  );
}

root.render(<Boot />);
Promise.all([hydrateStore(), aiService.init()])
  .then(() =>
    root.render(
      <React.StrictMode>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </React.StrictMode>,
    ),
  )
  .catch((e: Error) => root.render(<Boot error={e.message} />));
