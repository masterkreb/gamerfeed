import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  decodePersistedValue,
  parsePersistedValue,
  type PersistedStateDecoder,
} from '../shared/persisted-state';

export function useLocalStorage<T,>(
  key: string,
  initialValue: T,
  decoder: PersistedStateDecoder<T>,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const initialValueRef = useRef(initialValue);
  const decoderRef = useRef(decoder);
  initialValueRef.current = initialValue;
  decoderRef.current = decoder;

  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return parsePersistedValue(item, decoder, initialValue);
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback((value: T | ((val: T) => T)) => {
    setStoredValue(currentStoredValue => {
      const candidate = value instanceof Function ? value(currentStoredValue) : value;
      const valueToStore = decodePersistedValue(
        candidate,
        decoderRef.current,
        initialValueRef.current,
      );

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch {
          // Der React-Zustand bleibt auch verfügbar, wenn der Browser das
          // persistente Schreiben blockiert oder sein Kontingent erschöpft ist.
        }
      }

      return valueToStore;
    });
  }, [key]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;

      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }

      if (event.key === null) {
        setStoredValue(initialValueRef.current);
        return;
      }

      setStoredValue(parsePersistedValue(
        event.newValue,
        decoderRef.current,
        initialValueRef.current,
      ));
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [key]);

  return [storedValue, setValue as React.Dispatch<React.SetStateAction<T>>];
}
