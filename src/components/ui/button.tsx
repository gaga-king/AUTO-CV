import * as React from "react"
import { cn } from "@/src/lib/utils"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-950 disabled:pointer-events-none disabled:opacity-50",
          "bg-gray-900 text-gray-50 hover:bg-black hover:-translate-y-0.5 h-10 px-6 py-2",
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
