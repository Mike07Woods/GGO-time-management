// src/hooks/useMonitorScope.js
// Helper for team-scoping pages. Two kinds of user are restricted to "their
// team" and get `scoped = true`:
//   - monitors  -> their own department (read-only)
//   - managers  -> only the departments they are assigned to manage
//                  (department_managers); none assigned = no team
// Returns the team's member ids + department ids/name so pages can filter their
// queries (e.g. .in('user_id', memberIds)). For everyone else (employees, admins,
// owners) scoped=false and memberIds=null, so callers simply skip filtering.
// `isMonitor` is still returned because monitors are additionally read-only.

import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { useRole } from './useRole';
import { supabase } from '../supabaseClient';

export function useMonitorScope() {
  const { user } = useAuth();
  const { role, isMonitor, getCurrentDepartment } = useRole();
  const ownDept = getCurrentDepartment();
  const isTeamLead = role === 'manager';
  const scoped = isMonitor || isTeamLead;
  const userId = user?.id;

  const [memberIds, setMemberIds] = useState(null); // null until loaded (or not scoped)
  const [deptIds, setDeptIds] = useState(null);
  const [deptName, setDeptName] = useState('');
  const [ready, setReady] = useState(false); // true once we know the member list (or n/a)

  useEffect(() => {
    if (!scoped || !userId) {
      setMemberIds(null);
      setDeptIds(null);
      setDeptName('');
      setReady(true);
      return undefined;
    }
    let active = true;
    setReady(false);
    (async () => {
      // A manager's team is ONLY the department(s) they are assigned to manage.
      // Their own profile department does not count: everyone defaults into one
      // department (e.g. Operations), so using it would let managers see each
      // other. A manager with no assignment has no team. Monitors use their own
      // department.
      let list = [];
      if (isTeamLead) {
        const { data } = await supabase
          .from('department_managers')
          .select('department_id')
          .eq('user_id', userId);
        list = (data || []).map((d) => d.department_id);
      } else if (ownDept) {
        list = [ownDept];
      }

      let members = [];
      let names = [];
      if (list.length) {
        const [pRes, dRes] = await Promise.all([
          supabase.from('profiles').select('id').in('department_id', list),
          supabase.from('departments').select('name').in('id', list),
        ]);
        members = (pRes.data || []).map((p) => p.id);
        names = (dRes.data || []).map((d) => d.name).filter(Boolean);
      }
      if (!active) return;
      // A scoped user always sees themselves, even with no team yet. An empty
      // list (rather than null) keeps pages filtered instead of showing everyone.
      setMemberIds([...new Set([...members, userId])]);
      setDeptIds(list);
      setDeptName(names.join(', '));
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [scoped, isTeamLead, ownDept, userId]);

  return { isMonitor, scoped, monitorDept: ownDept, deptIds, memberIds, deptName, ready };
}

export default useMonitorScope;
