"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const loginSchema = z.object({
    email: z.string().email("Please enter a valid email"),
    password: z
        .string()
        .min(8, "Password must be at least 8 characters")
        .max(100, "Password must be 100 characters or less"),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
    const supabase = createClient();
    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<LoginValues>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            email: "",
            password: "",
        },
    });

    const onSubmit = async (values: LoginValues) => {
        const { error } = await supabase.auth.signInWithPassword({
            email: values.email,
            password: values.password,
        });

        if (error) {
            toast.error("Login failed", {
                description: error.message,
            });
        } else {
            toast.success("Signed in", {
                description: "Redirecting to your dashboard.",
            });
            window.location.href = "/dashboard";
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
            <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
                <form
                    className="grid gap-4 border p-2 mx-auto"
                    onSubmit={handleSubmit(onSubmit)}
                >
                    <h2 className="text-2xl font-bold">Log in</h2>

                    <div className="grid gap-1">
                        <Input
                            type="email"
                            placeholder="Email"
                            autoComplete="email"
                            aria-invalid={!!errors.email}
                            {...register("email")}
                        />
                        {errors.email?.message ? (
                            <p className="text-sm text-red-600 dark:text-red-400">
                                {errors.email.message}
                            </p>
                        ) : null}
                    </div>

                    <div className="grid gap-1">
                        <Input
                            type="password"
                            placeholder="Password"
                            autoComplete="current-password"
                            aria-invalid={!!errors.password}
                            {...register("password")}
                        />
                        {errors.password?.message ? (
                            <p className="text-sm text-red-600 dark:text-red-400">
                                {errors.password.message}
                            </p>
                        ) : null}
                    </div>

                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Signing in..." : "Log in"}
                    </Button>
                </form>
            </main>
        </div>
    );
}
