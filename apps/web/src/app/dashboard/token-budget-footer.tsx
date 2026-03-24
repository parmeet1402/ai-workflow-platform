"use client";

import * as React from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil } from "lucide-react";

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

const tokenBudgetSchema = z.object({
  tokenBudget: z
    .number()
    .int("Token budget must be a whole number")
    .min(1, "Token budget must be at least 1")
    .max(100000000, "Token budget is too large"),
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

function RadialUsageChart({ used, budget }: { used: number; budget: number }) {
  const ratio = budget > 0 ? Math.min(1, used / budget) : 0;
  const percent = Math.round(ratio * 100);

  const size = 96;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - ratio);

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
          className="stroke-primary"
          fill="transparent"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>

      <div className="absolute text-center">
        <div className="text-sm font-semibold">{percent}%</div>
        <div className="text-xs text-muted-foreground">used</div>
      </div>
    </div>
  );
}

export default function TokenBudgetFooter({
  tokensUsed,
  initialTokenBudget,
  costPerThousandTokens,
}: {
  tokensUsed: number;
  initialTokenBudget: number;
  costPerThousandTokens: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [tokenBudget, setTokenBudget] = React.useState(initialTokenBudget);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TokenBudgetValues>({
    resolver: zodResolver(tokenBudgetSchema),
    defaultValues: { tokenBudget: initialTokenBudget },
    mode: "onSubmit",
  });

  React.useEffect(() => {
    if (open) {
      reset({ tokenBudget });
    }
  }, [open, reset, tokenBudget]);

  const onSubmit = (values: TokenBudgetValues) => {
    setTokenBudget(values.tokenBudget);
    setOpen(false);
  };

  const cost = (tokensUsed / 1000) * costPerThousandTokens;

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-6">
          <div className="grid gap-1">
            <div className="text-sm">
              <span className="font-medium">Token Usage:</span>{" "}
              {tokensUsed.toLocaleString()} / {tokenBudget.toLocaleString()}{" "}
              tokens
            </div>
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Cost:</span>{" "}
              {formatUsd(cost)}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <div className="text-sm">
                <span className="font-medium">Token Budget:</span>{" "}
                {tokenBudget.toLocaleString()} tokens
              </div>

              <Dialog open={open} onOpenChange={setOpen}>
                {/* We open the dialog via the pencil button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setOpen(true)}
                  aria-label="Edit token budget"
                >
                  <Pencil className="size-4" />
                </Button>

                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit Token Budget</DialogTitle>
                    <DialogDescription>
                      Update your monthly/max token budget.
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
                        Token budget
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
                        Save
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

