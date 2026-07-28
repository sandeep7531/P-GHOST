import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ============================================================
// 🎯 SIMPLIFIED SESSION — Only what we actually need
// ============================================================

export interface SessionData {
    resume: string
    resumeFileName: string
    company: string
    position: string
    jobDescription: string
    isSetupComplete: boolean
}

interface SessionState extends SessionData {
    setResume: (text: string, fileName?: string) => void
    setCompany: (company: string) => void
    setPosition: (position: string) => void
    setJobDescription: (jd: string) => void
    markSetupComplete: () => void
    resetSession: () => void
}

const defaultState: SessionData = {
    resume: '',
    resumeFileName: '',
    company: '',
    position: '',
    jobDescription: '',
    isSetupComplete: false
}

export const useSessionStore = create<SessionState>()(
    persist(
        (set) => ({
            ...defaultState,

            setResume: (text, fileName = '') => set({ resume: text, resumeFileName: fileName }),
            setCompany: (company) => set({ company }),
            setPosition: (position) => set({ position }),
            setJobDescription: (jobDescription) => set({ jobDescription }),
            markSetupComplete: () => set({ isSetupComplete: true }),
            resetSession: () => set(defaultState)
        }),
        {
            name: 'ghost-session-storage',
            version: 2
        }
    )
)