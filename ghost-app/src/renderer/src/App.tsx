import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import SetupScreen from './screens/SetupScreen'
import Overlay from './Overlay'

function App(): JSX.Element {
    return (
        <HashRouter>
            <Routes>
                {/* Default → Setup Screen */}
                <Route path="/" element={<SetupScreen />} />

                {/* Overlay Screen */}
                <Route path="/overlay" element={<Overlay />} />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </HashRouter>
    )
}

export default App