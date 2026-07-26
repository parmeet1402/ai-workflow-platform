"use client";

import * as React from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useChatSession } from "./chat-session-context";

const tokenBudgetSchema = z.object({
  tokenBudget: z
    .number()
    .int("Monthly token cap must be a whole number")
    .min(1, "Monthly token cap must be at least 1")
    .max(100000000, "Monthly token cap is too large"),
});

type TokenBudgetValues = z.infer<typeof tokenBudgetSchema>;

function formatUsd(value: number) {
  // Use a fixed locale to avoid SSR vs browser locale hydration mismatches.
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "symbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function usageStrokeClass(percent: number) {
  if (percent > 90) return "stroke-rose-300";
  if (percent > 70) return "stroke-amber-200";
  return "stroke-primary";
}

function usageTextClass(percent: number) {
  if (percent > 90) return "text-rose-300";
  if (percent > 70) return "text-amber-200";
  return undefined;
}

function RadialUsageChart({ used, budget }: { used: number; budget: number }) {
  const rawRatio = budget > 0 ? used / budget : 0;
  const ratio = Math.min(1, Math.max(0, rawRatio));
  const percent = Math.round(ratio * 100);
  const overCap = rawRatio > 1;

  const size = 96;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - ratio);
  const strokeClass = usageStrokeClass(overCap ? 101 : percent);
  const textClass = usageTextClass(overCap ? 101 : percent);

  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="stroke-muted-foreground/30"
          fill="transparent"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          className={strokeClass}
          fill="transparent"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>

      <div className="absolute text-center">
        <div className={["text-sm font-semibold", textClass].filter(Boolean).join(" ")}>
          {percent}%
        </div>
        <div className="text-xs text-muted-foreground">
          {overCap ? "over cap" : "used"}
        </div>
      </div>
    </div>
  );
}

export default function TokenBudgetFooter() {
  const {
    sessionTokensUsed,
    tokenBudget,
    setTokenBudget,
    costPerThousandTokens,
  } = useChatSession();
  const [open, setOpen] = React.useState(false);
  const tokensUsed = sessionTokensUsed;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TokenBudgetValues>({
    resolver: zodResolver(tokenBudgetSchema),
    defaultValues: { tokenBudget },
    mode: "onSubmit",
  });

  React.useEffect(() => {
    if (open) {
      reset({ tokenBudget });
    }
  }, [open, reset, tokenBudget]);

  const onSubmit = async (values: TokenBudgetValues) => {
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenBudget: values.tokenBudget }),
      });
      const payload = (await res.json()) as
        | { tokenBudget: number }
        | { error: string };

      if (!res.ok) {
        throw new Error(
          "error" in payload
            ? payload.error
            : "Failed to save monthly usage cap",
        );
      }
      if (!("tokenBudget" in payload)) {
        throw new Error("Invalid response from server");
      }

      setTokenBudget(payload.tokenBudget);
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save monthly usage cap",
      );
    }
  };

  const cost = (tokensUsed / 1000) * costPerThousandTokens;

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-6">
          <div className="grid gap-1">
            <div className="text-sm">
              <span className="font-medium">This month:</span>{" "}
              {tokensUsed.toLocaleString()} / {tokenBudget.toLocaleString()}{" "}
              tokens
            </div>
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Cost this month:</span>{" "}
              {formatUsd(cost)}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <div className="text-sm">
                <span className="font-medium">Monthly cap:</span>{" "}
                {tokenBudget.toLocaleString()} tokens
              </div>

              <Dialog open={open} onOpenChange={setOpen}>
                {/* We open the dialog via the pencil button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setOpen(true)}
                  aria-label="Edit monthly usage cap"
                >
                  <Pencil className="size-4" />
                </Button>

                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit monthly usage cap</DialogTitle>
                    <DialogDescription>
                      Shared across the org. Usage resets on the 1st of each
                      month. Chat is blocked once the cap is reached.
                    </DialogDescription>
                  </DialogHeader>

                  <form
                    onSubmit={handleSubmit(onSubmit)}
                    className="grid gap-4"
                  >
                    <div className="grid gap-2">
                      <label
                        htmlFor="tokenBudget"
                        className="text-sm font-medium"
                      >
                        Monthly token cap
                      </label>
                      <Input
                        id="tokenBudget"
                        type="number"
                        inputMode="numeric"
                        {...register("tokenBudget", { valueAsNumber: true })}
                        aria-invalid={!!errors.tokenBudget}
                      />
                      {errors.tokenBudget?.message ? (
                        <p className="text-sm text-red-600 dark:text-red-400">
                          {errors.tokenBudget.message}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        Used this month: {tokensUsed.toLocaleString()} ·{" "}
                        {formatUsd(cost)} at current rate
                      </p>
                    </div>

                    <DialogFooter>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setOpen(false)}
                        disabled={isSubmitting}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Saving…" : "Save"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <RadialUsageChart used={tokensUsed} budget={tokenBudget} />
      </CardContent>
    </Card>
  );
}
