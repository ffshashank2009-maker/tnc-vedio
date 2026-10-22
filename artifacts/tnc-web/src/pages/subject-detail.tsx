import { Link, useParams } from "wouter";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, ChevronRight, FileText, Lock, PlayCircle, Search, X } from "lucide-react";
import Layout from "@/components/Layout";
import StudyEmptyState from "@/components/StudyEmptyState";
import { customFetch } from "@/lib/api-client";
import { useGetCourses, useGetPromoStatus, useGetUserPurchases, getGetUserPurchasesQueryKey } from "@/lib/api-client";
import { getUser } from "@/lib/auth";

interface Subject {
  rowId: string;
  name: string;
  videoCount: number;
  pdfCount: number;
  totalCount: number;
}

interface SubjectSession {
  rowId: string;
  title: string;
  videoUrl?: string | null;
  pdfUrl?: string | null;
  pdfUrls?: string[];
  contentType: string;
  isPaid: boolean;
  serialNo: string;
  createdAt?: string;
}

type ContentFilter = "all" | "video" | "pdf" | "quiz";
type SortMode = "display" | "newest" | "oldest";

function isVideo(session: SubjectSession) {
  return session.contentType === "youtube" || session.contentType === "firebase" || Boolean(session.videoUrl);
}

function isPdf(session: SubjectSession) {
  return session.contentType === "pdf" || Boolean(session.pdfUrl);
}

export default function SubjectDetailPage() {
  const { courseId, subjectId } = useParams<{ courseId: string; subjectId: string }>();
  const user = getUser();
  const [filter, setFilter] = useState<ContentFilter>("all");
  const [sort, setSort] = useState<SortMode>("display");
  const [search, setSearch] = useState("");

  const { data: courses } = useGetCourses();
  const course = (Array.isArray(courses) ? courses : []).find((item) => item.rowId === courseId);
  const { data: subjects = [], isLoading: subjectsLoading } = useQuery<Subject[]>({
    queryKey: ["subjects", courseId],
    enabled: !!courseId,
    queryFn: () => customFetch<Subject[]>(`/api/subjects?courseId=${encodeURIComponent(courseId ?? "")}`),
  });
  const subject = subjects.find((item) => item.rowId === subjectId);

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<SubjectSession[]>({
    queryKey: ["sessions", courseId, subjectId, search],
    enabled: !!courseId && !!subjectId,
    queryFn: () => customFetch<SubjectSession[]>(
      `/api/sessions?courseId=${encodeURIComponent(courseId ?? "")}&subjectId=${encodeURIComponent(subjectId ?? "")}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    ),
  });
  const { data: promo } = useGetPromoStatus();
  const { data: purchases } = useGetUserPurchases(user?.userId ?? "", {
    query: { enabled: !!user, queryKey: getGetUserPurchasesQueryKey(user?.userId ?? "") },
  });
  const isCourseUnlocked = Boolean(promo?.enabled) || (Array.isArray(purchases) && purchases.some((purchase) => purchase.courseId === courseId));

  const visibleSessions = useMemo(() => {
    const filtered = sessions.filter((session) => {
      if (filter === "video") return isVideo(session);
      if (filter === "pdf") return isPdf(session);
      if (filter === "quiz") return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sort === "newest") return String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
      if (sort === "oldest") return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
      return (parseFloat(a.serialNo) || Number.MAX_SAFE_INTEGER) - (parseFloat(b.serialNo) || Number.MAX_SAFE_INTEGER);
    });
  }, [filter, sessions, sort]);

  const isLoading = subjectsLoading || sessionsLoading;

  if (!isLoading && (!course || !subject)) {
    return (
      <Layout>
        <div className="mx-auto max-w-4xl px-4 py-20 text-center">
          <StudyEmptyState title="Subject not found" message="Return to the course and choose another subject." />
          <Link href={courseId ? `/courses/${courseId}` : "/courses"} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-600">
            <ArrowLeft size={15} /> Back to course
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="tnc-hero-gradient text-white">
        <div className="mx-auto max-w-4xl px-4 py-7">
          <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-white/70">
            <Link href="/courses" className="hover:text-white">Courses</Link>
            <span>/</span>
            <Link href={`/courses/${courseId}`} className="hover:text-white">{course?.name ?? "Course"}</Link>
            <span>/</span>
            <span className="text-white">{subject?.name ?? "Subject"}</span>
          </div>
          <Link href={`/courses/${courseId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-white/75 hover:text-white">
            <ArrowLeft size={15} /> Back to {course?.name ?? "course"}
          </Link>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15"><BookOpen size={23} /></div>
            <div>
              <h1 className="text-2xl font-black">{subject?.name ?? "Subject"}</h1>
              <p className="mt-1 text-sm text-white/75">{subject?.videoCount ?? 0} Videos · {subject?.pdfCount ?? 0} PDFs · {subject?.totalCount ?? 0} Items</p>
            </div>
          </div>
        </div>
      </div>

      <div className="sticky top-16 z-30 border-b bg-white">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1 overflow-x-auto">
            {([
              ["all", "All"],
              ["video", "Videos"],
              ["pdf", "PDFs"],
              ["quiz", "Quizzes"],
            ] as const).map(([value, label]) => (
              <button key={value} onClick={() => setFilter(value)} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${filter === value ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-100"}`}>
                {label}
              </button>
            ))}
          </div>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600">
            <option value="display">Display order</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="relative mb-5">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${subject?.name ?? "subject"} content...`} className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X size={16} /></button>}
        </div>

        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3, 4].map((item) => <div key={item} className="h-16 rounded-xl skeleton" />)}</div>
        ) : visibleSessions.length === 0 ? (
          <StudyEmptyState title={filter === "quiz" ? "No quizzes available in this subject yet" : "No learning content available in this subject yet"} />
        ) : (
          <div className="space-y-2">
            {visibleSessions.map((session, index) => {
              const video = isVideo(session);
              const pdf = isPdf(session);
              const locked = session.isPaid && !isCourseUnlocked;
              const href = pdf && !video ? `/pdf/${session.rowId}` : `/watch/${session.rowId}`;
              const typeLabel = pdf && !video ? "PDF" : session.contentType === "firebase" ? "SECURED VIDEO" : video ? "VIDEO" : "CONTENT";
              const attachmentUrls = (session.pdfUrls ?? []).slice(video ? 0 : 1);
              return locked ? (
                <div key={session.rowId} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 opacity-70">
                  <Lock size={18} className="shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-gray-600">{index + 1}. {session.title}</p><p className="text-xs text-gray-400">Purchase course to unlock</p></div>
                  <span className="text-[10px] font-semibold text-gray-400">LOCKED</span>
                </div>
              ) : (
                <div key={session.rowId}>
                  <Link href={href} className="group flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:border-blue-200 hover:shadow-md">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${pdf && !video ? "bg-red-50 text-red-500" : "bg-blue-50 text-blue-600"}`}>{pdf && !video ? <FileText size={19} /> : <PlayCircle size={19} />}</div>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-gray-900">{index + 1}. {session.title}</p><p className="text-xs text-gray-400">{typeLabel} · {session.isPaid ? "Premium" : "Free"}</p></div>
                    <ChevronRight size={17} className="shrink-0 text-gray-300 transition-colors group-hover:text-blue-600" />
                  </Link>
                  {attachmentUrls.length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 pt-2">
                      {attachmentUrls.map((url, pdfIndex) => (
                        <a key={`${session.rowId}-pdf-${pdfIndex + (video ? 1 : 2)}`} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline">
                          <FileText size={13} /> {session.title} · PDF {pdfIndex + (video ? 1 : 2)}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
