"use client";

import { createClient } from "@/lib/supabase/client";
import { LogOutIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export default function LogoutButton() {
    const supabase = createClient();

    const logout = async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
    };

    return (<Tooltip>
        <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={logout}>
                <LogOutIcon className="size-4" />
            </Button>
        </TooltipTrigger>
        <TooltipContent>
            <p>Logout</p>
        </TooltipContent>
    </Tooltip>);
}