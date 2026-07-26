import LogoutButton from "@/components/logout-button";
import ThemeToggleButton from "@/components/theme-toggle-button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ChatControlsProvider } from "./chat-controls-context";
import {
    ChatSessionProvider,
    DEFAULT_TOKEN_BUDGET,
} from "./chat-session-context";
import DashboardChat from "./dashboard-chat";
import DashboardDocuments from "./dashboard-documents";
import DashboardSettings from "./dashboard-settings";
import TokenBudgetFooter from "./token-budget-footer";

async function loadOrgTokenBudget(
    supabase: Awaited<ReturnType<typeof createClient>>,
    userId: string,
): Promise<number> {
    const { data: membership } = await supabase
        .from("memberships")
        .select("organization_id")
        .eq("user_id", userId)
        .maybeSingle();

    if (!membership?.organization_id) {
        return DEFAULT_TOKEN_BUDGET;
    }

    const { data: org } = await supabase
        .from("organizations")
        .select("token_budget")
        .eq("id", membership.organization_id)
        .maybeSingle();

    const budget = org?.token_budget;
    return typeof budget === "number" && budget >= 1
        ? budget
        : DEFAULT_TOKEN_BUDGET;
}

export default async function Dashboard() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login");
    }

    const initialTokenBudget = await loadOrgTokenBudget(supabase, user.id);

    return (
        <ChatSessionProvider initialTokenBudget={initialTokenBudget}>
            <ChatControlsProvider>
                <div className="flex h-screen flex-col gap-4 p-6">
                    <header className="flex items-center justify-between">
                        <div className="text-lg font-semibold">
                            AI Workflow Platform
                        </div>

                        <div className="flex items-center gap-3">
                            <Badge variant="secondary">{user.email}</Badge>
                            <ThemeToggleButton />
                            <DashboardSettings />
                            <LogoutButton />
                        </div>
                    </header>

                    <main className="min-h-0 flex-1">
                        <div className="grid h-full min-h-0 grid-cols-[4fr_6fr] items-stretch gap-4">
                            <DashboardDocuments />

                            <aside className="min-h-0 flex h-full">
                                <DashboardChat />
                            </aside>
                        </div>
                    </main>

                    <footer className="mt-auto">
                        <TokenBudgetFooter />
                    </footer>
                </div>
            </ChatControlsProvider>
        </ChatSessionProvider>
    );
}