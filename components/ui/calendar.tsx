"use client"

import * as React from "react"
import { DayPicker } from "react-day-picker"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months:        "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month:         "space-y-4",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-semibold text-[#1f1b2e]",
        nav:           "space-x-1 flex items-center",
        button_previous: "absolute left-1 h-7 w-7 bg-transparent p-0 flex items-center justify-center rounded-md border border-[#e8e7ef] text-[#7b7990] hover:bg-[#f0eff7] transition-colors",
        button_next:     "absolute right-1 h-7 w-7 bg-transparent p-0 flex items-center justify-center rounded-md border border-[#e8e7ef] text-[#7b7990] hover:bg-[#f0eff7] transition-colors",
        month_grid:    "w-full border-collapse",
        weekdays:      "flex",
        weekday:       "text-[#a8a5bb] rounded-md w-9 font-medium text-[0.8rem] text-center uppercase tracking-wide",
        week:          "flex w-full mt-2",
        day:           "h-9 w-9 text-center text-sm p-0 relative",
        day_button:    "h-9 w-9 p-0 font-normal rounded-md flex items-center justify-center text-[#3d3a52] hover:bg-[#f0eff7] hover:text-[#1f1b2e] transition-colors w-full",
        selected:      "[&>button]:bg-[#5d5fef] [&>button]:text-white [&>button]:hover:bg-[#4e50d8]",
        today:         "[&>button]:bg-[#eeeefd] [&>button]:text-[#5d5fef] [&>button]:font-semibold",
        outside:       "opacity-50",
        disabled:      "opacity-40",
        hidden:        "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left'
            ? <ChevronLeft className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
