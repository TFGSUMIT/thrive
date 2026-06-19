import { createContext, useContext, useState, useCallback } from 'react'
import './ConfirmModal.css'

const ConfirmContext = createContext()

export function ConfirmProvider({ children }) {
    const [state, setState] = useState(null)
    // state: { message, resolve, danger }

    const confirm = useCallback((message, { danger = false } = {}) => {
        return new Promise((resolve) => {
            setState({ message, resolve, danger })
        })
    }, [])

    const handleResponse = (answer) => {
        if (state) {
            state.resolve(answer)
            setState(null)
        }
    }

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            {state && (
                <>
                    <div className="modal-overlay" onClick={() => handleResponse(false)} />
                    <div className="modal">
                        <div className="modal-body">{state.message}</div>
                        <div className="modal-actions">
                            <button className="btn" onClick={() => handleResponse(false)}>Cancel</button>
                            <button
                                className={`btn ${state.danger ? 'btn-danger-solid' : 'btn-primary'}`}
                                onClick={() => handleResponse(true)}
                                autoFocus
                            >
                                {state.danger ? 'Delete' : 'Confirm'}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </ConfirmContext.Provider>
    )
}

export function useConfirm() {
    return useContext(ConfirmContext)
}