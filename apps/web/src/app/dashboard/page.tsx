import LogoutButton from "@/components/logout-button";
import ThemeToggleButton from "@/components/theme-toggle-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SettingsIcon } from "lucide-react";
import DashboardChat from "./dashboard-chat";
import DashboardDocuments from "./dashboard-documents";
import TokenBudgetFooter from "./token-budget-footer";

export default async function Dashboard() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login");
    }

    return (
        <div className="flex h-screen flex-col gap-4 p-6">
            <header className="flex items-center justify-between">
                <div className="text-lg font-semibold">AI Workflow Platform</div>

                <div className="flex items-center gap-3">
                    <Badge variant="secondary">{user.email}</Badge>
                    <ThemeToggleButton />

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="Settings">
                                <SettingsIcon className="size-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Settings</p>
                        </TooltipContent>
                    </Tooltip>

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
                <TokenBudgetFooter
                    tokensUsed={100}
                    initialTokenBudget={1000}
                    costPerThousandTokens={0.01}
                />
            </footer>
        </div>
    );
}