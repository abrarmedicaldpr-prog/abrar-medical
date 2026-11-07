import React, { useState, useEffect, useRef } from 'react';
import {
  Database,
  Clock,
  RefreshCw,
  ShieldCheck,
  Globe,
  LogOut,
  ChevronDown,
  Users,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { DatabaseDiagnostics } from '../../types/database';
import { formatPKTTime, formatPKTDate } from '../../utils/formatters';
import { useAuth } from '../../context/AuthContext';

interface TopHeaderProps {
  currentViewTitle: string;
  breadcrumbs: string[];
  diagnostics: DatabaseDiagnostics | null;
  loading: boolean;
  onRefresh: () => void;
  onNavigateToUsers?: () => void;
  onNavigateToAudit?: () => void;
  onNavigateToClearDemoData?: () => void;
  compact?: boolean;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  currentViewTitle,
  breadcrumbs,
  diagnostics,
  loading,
  onRefresh,
  onNavigateToUsers,
  onNavigateToAudit,
  onNavigateToClearDemoData,
  compact = false,
}) => {
  const { user, logout, isSuperAdmin } = useAuth();
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [profileMenuOpen, setProfileMenuOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header
      className={`${
        compact ? 'h-9 px-3' : 'h-14 px-5'
      } bg-white border-b border-slate-200 flex items-center justify-between sticky top-0 z-20 shadow-2xs shrink-0 print:hidden`}
    >
      {/* Left: Breadcrumbs & View Title */}
      <div className={compact ? 'flex items-center gap-2 min-w-0' : 'flex flex-col min-w-0'}>
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 shrink-0">
          <span>Abrar Medical Store</span>
          <span>/</span>
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={crumb}>
              <span className={idx === breadcrumbs.length - 1 ? 'text-emerald-700 font-semibold' : ''}>
                {crumb}
              </span>
              {idx < breadcrumbs.length - 1 && <span>/</span>}
            </React.Fragment>
          ))}
        </div>
        {!compact && (
          <h1 className="text-base font-bold text-slate-900 tracking-tight leading-tight truncate">
            {currentViewTitle}
          </h1>
        )}
      </div>

      {/* Right: Live Diagnostics, PKT Time, Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Pakistan Standard Time Live Clock */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
          <Clock className="w-3.5 h-3.5 text-emerald-600" />
          <div className="text-[11px] font-mono flex items-center gap-1.5">
            <span className="font-semibold text-slate-900">{formatPKTTime(currentTime)}</span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-600">{formatPKTDate(currentTime)}</span>
            <span className="px-1 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold">
              PKT
            </span>
          </div>
        </div>

        {/* Database Live Connectivity Badge */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium ${
            diagnostics?.connected
              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
          title={diagnostics?.connected ? `Connected: ${diagnostics.databasePath}` : diagnostics?.error || 'Database disconnected'}
        >
          <Database className={`w-3 h-3 ${diagnostics?.connected ? 'text-emerald-600' : 'text-rose-600'}`} />
          <span className="font-semibold">
            {diagnostics?.connected ? 'SQLite WAL' : 'DB Offline'}
          </span>
        </div>

        {!compact && (
          <div className="hidden xl:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100/70 text-slate-600 text-[11px] font-medium border border-slate-200/60">
            <span className="font-bold text-slate-800">PKR (₨)</span>
            <span className="text-slate-400">•</span>
            <span className="flex items-center gap-1">
              <Globe className="w-3 h-3 text-slate-500" />
              English
            </span>
          </div>
        )}

        {/* Refresh Diagnostics Button */}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-[11px] font-medium transition-all shadow-2xs disabled:opacity-50 cursor-pointer"
          title="Re-check database and system status"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {!compact && <span>Sync</span>}
        </button>

        {/* Authenticated User Profile Menu & Direct Logout */}
        {user && (
          <div className="flex items-center gap-1.5 pl-1.5 border-l border-slate-200 relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setProfileMenuOpen((prev) => !prev)}
              className="flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
              title="Open User Profile & Session Menu"
            >
              <div className="w-5 h-5 rounded bg-emerald-700 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                {user.full_name.charAt(0).toUpperCase()}
              </div>
              <div className="text-left hidden md:block">
                <div className="text-[11px] font-bold text-slate-900 leading-tight">
                  {user.full_name}
                </div>
              </div>
              <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                {user.role}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            <button
              type="button"
              onClick={() => {
                setProfileMenuOpen(false);
                logout();
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-semibold transition-colors cursor-pointer"
              title="Sign Out / Terminate Session"
            >
              <LogOut className="w-3 h-3" />
              <span className="hidden sm:inline">Logout</span>
            </button>

            {/* User Profile Dropdown Menu */}
            {profileMenuOpen && (
              <div className="absolute right-0 top-10 w-72 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50 text-xs">
                <div className="px-4 py-2.5 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-emerald-700 text-white flex items-center justify-center text-sm font-bold shrink-0">
                      {user.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 truncate">{user.full_name}</div>
                      <div className="text-[11px] font-mono text-slate-500 truncate">@{user.username}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Assigned Role:</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold border border-emerald-200">
                      {user.role}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Session Security:</span>
                    <span className="text-emerald-700 font-semibold flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> Verified Token
                    </span>
                  </div>
                </div>

                <div className="py-1 border-b border-slate-100">
                  {isSuperAdmin && onNavigateToUsers && (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onNavigateToUsers();
                      }}
                      className="w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium cursor-pointer"
                    >
                      <Users className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Manage Staff & Role Permissions</span>
                    </button>
                  )}
                  {onNavigateToAudit && (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onNavigateToAudit();
                      }}
                      className="w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium cursor-pointer"
                    >
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                      <span>View Security & Audit Logs</span>
                    </button>
                  )}
                  {onNavigateToClearDemoData && (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onNavigateToClearDemoData();
                      }}
                      className="w-full px-4 py-2 text-left text-rose-700 hover:bg-rose-50 flex items-center gap-2 font-medium cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                      <span>Clear Temporary / Demo Data</span>
                    </button>
                  )}
                </div>

                <div className="pt-1 px-2">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      logout();
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left text-rose-700 bg-rose-50/70 hover:bg-rose-100 flex items-center justify-between font-bold transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Logout of Abrar Medical Store</span>
                    </span>
                    <span className="text-[10px] font-mono uppercase">End Session</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

