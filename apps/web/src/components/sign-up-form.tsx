import { Button } from "@open-vidiq/ui/components/button";
import { Input } from "@open-vidiq/ui/components/input";
import { Label } from "@open-vidiq/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { clearSessionCache } from "@/lib/session";

import Loader from "./loader";

export default function SignUpForm({
	onSwitchToSignIn,
	redirectTo,
}: {
	onSwitchToSignIn: () => void;
	/** Same-app path to open after creating the account. */
	redirectTo: string;
}) {
	const navigate = useNavigate();
	const { isPending } = authClient.useSession();

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
			name: "",
		},
		onSubmit: async ({ value }) => {
			const { error } = await authClient.signUp.email({
				email: value.email,
				password: value.password,
				name: value.name,
			});
			if (error) {
				toast.error(
					error.message || error.statusText || "Couldn't create the account.",
				);
				return;
			}
			clearSessionCache();
			toast.success("Account created");
			await navigate({ href: redirectTo, replace: true });
		},
		validators: {
			onSubmit: z.object({
				name: z
					.string()
					.min(2, "Name must be at least 2 characters")
					.max(100, "Name must be at most 100 characters"),
				email: z.email("Invalid email address"),
				password: z.string().min(8, "Password must be at least 8 characters"),
			}),
		},
	});

	if (isPending) {
		return <Loader />;
	}

	return (
		<div className="flex w-full flex-col gap-6">
			<div className="flex flex-col gap-1.5 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					Create your account
				</h1>
				<p className="text-muted-foreground text-sm">
					Free forever. No plans, no credits, no limits.
				</p>
			</div>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					form.handleSubmit();
				}}
				className="flex flex-col gap-4"
				noValidate
			>
				<form.Field name="name">
					{(field) => (
						<div className="flex flex-col gap-2">
							<Label htmlFor={field.name}>Name</Label>
							<Input
								id={field.name}
								name={field.name}
								autoComplete="name"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
								aria-invalid={field.state.meta.errors.length > 0 || undefined}
							/>
							{field.state.meta.errors.map((error) => (
								<p key={error?.message} className="text-destructive text-xs">
									{error?.message}
								</p>
							))}
						</div>
					)}
				</form.Field>

				<form.Field name="email">
					{(field) => (
						<div className="flex flex-col gap-2">
							<Label htmlFor={field.name}>Email</Label>
							<Input
								id={field.name}
								name={field.name}
								type="email"
								autoComplete="email"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
								aria-invalid={field.state.meta.errors.length > 0 || undefined}
							/>
							{field.state.meta.errors.map((error) => (
								<p key={error?.message} className="text-destructive text-xs">
									{error?.message}
								</p>
							))}
						</div>
					)}
				</form.Field>

				<form.Field name="password">
					{(field) => (
						<div className="flex flex-col gap-2">
							<Label htmlFor={field.name}>Password</Label>
							<Input
								id={field.name}
								name={field.name}
								type="password"
								autoComplete="new-password"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
								aria-invalid={field.state.meta.errors.length > 0 || undefined}
							/>
							{field.state.meta.errors.map((error) => (
								<p key={error?.message} className="text-destructive text-xs">
									{error?.message}
								</p>
							))}
						</div>
					)}
				</form.Field>

				<form.Subscribe
					selector={(state) => ({
						canSubmit: state.canSubmit,
						isSubmitting: state.isSubmitting,
					})}
				>
					{({ canSubmit, isSubmitting }) => (
						<Button
							type="submit"
							size="lg"
							className="w-full"
							disabled={!canSubmit || isSubmitting}
						>
							{isSubmitting ? "Creating account…" : "Create account"}
						</Button>
					)}
				</form.Subscribe>
			</form>

			<p className="text-muted-foreground text-center text-xs">
				Already have an account?{" "}
				<Button
					variant="link"
					size="xs"
					onClick={onSwitchToSignIn}
					className="px-0"
				>
					Sign in
				</Button>
			</p>
		</div>
	);
}
