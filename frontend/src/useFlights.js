import { useEffect, useState } from 'react';
import { api } from './api.js';

// Bookings only store the flight number, so route and times are read from Flight.
// A failed lookup just leaves that ticket without those details.
export function useFlights(ids) {
  const [flights, setFlights] = useState({});
  const key = [...new Set(ids.filter(Boolean))].sort().join(',');

  useEffect(() => {
    if (!key) return undefined;

    let active = true;
    Promise.allSettled(key.split(',').map((id) => api(`/flights/${id}`))).then((results) => {
      if (!active) return;
      const loaded = results.filter((result) => result.status === 'fulfilled');
      setFlights(Object.fromEntries(loaded.map(({ value }) => [value.id, value])));
    });
    return () => { active = false; };
  }, [key]);

  return flights;
}
