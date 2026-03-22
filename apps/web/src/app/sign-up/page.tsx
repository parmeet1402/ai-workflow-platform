"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAuthErrorMessage } from "@/lib/auth/supabase-errors";
import { createClient } from "@/lib/supabase/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const signUpSchema = z.object({
    name: z
        .string()
        .min(2, "Name must be at least 2 characters")
        .max(50, "Name must be 50 characters or less"),
    email: z.string().email("Please enter a valid email"),
    password: z
        .string()
        .min(8, "Password must be at least 8 characters")
        .max(100, "Password must be 100 characters or less"),
});

type SignUpValues = z.infer<typeof signUpSchema>;

export default function SignUpPage() {
    const supabase = createClient();
    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<SignUpValues>({
        resolver: zodResolver(signUpSchema),
        defaultValues: {
            name: "",
            email: "",
            password: "",
        },
    });

    const onSubmit = async (values: SignUpValues) => {
        const { error } = await supabase.auth.signUp({
            email: values.email,
            password: values.password,
            options: {
                emailRedirectTo: `${location.origin}/auth/callback`,
                data: {
                    full_name: values.name,
                },
            },
        });

        if (error) {
            toast.error("Sign up failed", {
                description: getAuthErrorMessage(error),
            });
        } else {
            toast.success("Sign up successful", {
                description: "Please check your email for verification",
            });
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
            <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
                <form
                    className="grid gap-4 border p-2 mx-auto"
                    onSubmit={handleSubmit(onSubmit)}
                >
                    <h2 className="text-2xl font-bold">Sign up</h2>

                    <div className="grid gap-1">
                        <Input
                            type="text"
                            placeholder="Name"
                            autoComplete="name"
                            aria-invalid={!!errors.name}
                            {...register("name")}
                        />
                        {errors.name?.message ? (
                            <p className="text-sm text-red-600 dark:text-red-400">
                                {errors.name.message}
                            </p>
                        ) : null}
                    </div>

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
                            autoComplete="new-password"
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
                        {isSubmitting ? "Signing up..." : "Sign Up"}
                    </Button>
                </form>
            </main>
        </div>
    );
}
