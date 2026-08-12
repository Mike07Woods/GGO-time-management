// src/hooks/useMonitorScope.js
// Helper for department-scoping pages when the current user is a "monitor".
// Returns the monitor's department members (ids) + department name so pages can
// filter their queries (e.g. .in('user_id', memberIds)). For non-monitors it
// returns isMonitor=false and memberIds=null, so callers simply skip filtering.

import { useEffect, useState } from 'react';
import { useRole } from './useRole';
import { supabase } from '../supabaseClient';

export function useMonitorScope() {
  const { isMonitor, getCurrentDepartment } = useRole();
  const monitorDept = getCurrentDepartment();

  const [memberIds, setMemberIds] = useState(null); // null until loaded (or not a monitor)
  const [deptName, setDeptName] = useState('');
  const [ready, setReady] = useState(false); // true once we know the member list (or n/a)

  useEffect(() => {
    if (!isMonitor || !monitorDept) {
      setMemberIds(null);
      setDeptName('');
      setReady(true);
      return undefined;
    }
    let active = true;
    setReady(false);
    (async () => {
      const [pRes, dRes] = await Promise.all([
        supabase.from('profiles').select('id').eq('department_id', monitorDept),
        supabase.from('departments').select('name').eq('id', monitorDept).maybeSingle(),
      ]);
      if (!active) return;
      setMemberIds((pRes.data || []).map((p) => p.id));
      setDeptName(dRes.data?.name || '');
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [isMonitor, monitorDept]);

  return { isMonitor, monitorDept, memberIds, deptName, ready };
}

export default useMonitorScope;
