import * as React from "react";
import {Slot} from "@radix-ui/react-slot";
import {cva,type VariantProps} from "class-variance-authority";
import {cn} from "@/lib/utils";
const buttonVariants=cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",{variants:{variant:{default:"bg-emerald-700 text-white hover:bg-emerald-800",outline:"border border-slate-200 bg-white hover:bg-slate-50",ghost:"hover:bg-emerald-50",destructive:"bg-red-600 text-white hover:bg-red-700"},size:{default:"h-10 px-4 py-2",sm:"h-9 px-3",lg:"h-12 px-6",icon:"size-10"}},defaultVariants:{variant:"default",size:"default"}});
function Button({className,variant,size,asChild=false,...props}:React.ComponentProps<"button">&VariantProps<typeof buttonVariants>&{asChild?:boolean}){const Comp=asChild?Slot:"button";return <Comp data-slot="button" className={cn(buttonVariants({variant,size,className}))} {...props}/>};export {Button,buttonVariants};
