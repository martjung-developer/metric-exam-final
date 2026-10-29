// hooks/admin/dashboard/useAdminDashboard.ts
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  fetchDashboardData,
  fetchDisplayName,
} from "@/lib/services/admin/dashboard/adminDashboard.service";
import { INITIAL_STATS } from "@/lib/types/admin/dashboard/dashboard";
import type {
  DashboardStats,
  PendingSubmission,
  ExamNeedingKey,
  RecentActivity,
} from "@/lib/types/admin/dashboard/dashboard";
 
export interface UseAdminDashboardReturn {
  displayName:     string | null;
  stats:           DashboardStats;
  pendingSubs:     PendingSubmission[];
  recentActivity:  RecentActivity[];
  examsNeedingKey: ExamNeedingKey[];
  loading:         boolean;
  /** true once the first paint is done — used to trigger CSS transitions */
  mounted:         boolean;
  refresh:          () => Promise<void>;
}
 
export function useAdminDashboard(user: User | null): UseAdminDashboardReturn {
  // Single stable client for the lifetime of this hook instance
  const supabase = useMemo(() => createClient(), []);
 
  const [displayName,    setDisplayName]    = useState<string | null>(null);
  const [stats,          setStats]          = useState<DashboardStats>(INITIAL_STATS);
  const [pendingSubs,    setPendingSubs]    = useState<PendingSubmission[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [examsNeedingKey,setExamsNeedingKey]= useState<ExamNeedingKey[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [mounted,        setMounted]        = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return
    const [name, data] = await Promise.all([
      fetchDisplayName(supabase, user.id, user.email ?? 'User'),
      fetchDashboardData(supabase, user.id),
    ])
    setDisplayName(name)
    setStats(data.stats)
    setPendingSubs(data.pendingSubs)
    setRecentActivity(data.recentActivity)
    setExamsNeedingKey(data.examsNeedingKey)
    setLoading(false)
  }, [supabase, user])
 
  // Prevent double-fetch in React Strict Mode
 
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
 
  useEffect(() => {
    if (!user) return
 
    void refresh()
  }, [user, refresh]);

  useEffect(() => {
    const revalidate = () => { if (!document.hidden) void refresh() }
    const interval = window.setInterval(revalidate, 30000)
    window.addEventListener('focus', revalidate)
    document.addEventListener('visibilitychange', revalidate)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', revalidate); document.removeEventListener('visibilitychange', revalidate) }
  }, [refresh])

  const forceRefresh = useCallback(async () => {
    setLoading(true)
    await refresh()
  }, [refresh])
 
  return {
    displayName,
    stats,
    pendingSubs,
    recentActivity,
    examsNeedingKey,
    loading,
    mounted,
    refresh: forceRefresh,
  };
}
