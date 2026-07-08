import { useState } from 'react'
import axios from 'axios'
import '../styles/Library.css'

const PLACEHOLDER_COVER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"%3E%3Crect fill="%23222" width="200" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" fill="%23666" font-size="14" dy=".3em"%3E📖%3C/text%3E%3C/svg%3E'

export default function Library({ books, setBooks, selectedBook, setSelectedBook, highlights }) {
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState('all')

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!search.trim()) return

    setLoading(true)
    let results = []

    if (source === 'all') {
      const [ia, ol, se, gb] = await Promise.all([
        searchInternetArchive(search),
        searchOpenLibrary(search),
        searchStandardEbooks(search),
        searchGutenberg(search)
      ])
      results = [...ia, ...ol, ...se, ...gb]
    } else if (source === 'internet-archive') {
      results = await searchInternetArchive(search)
    } else if (source === 'open-library') {
      results = await searchOpenLibrary(search)
    } else if (source === 'standard-ebooks') {
      results = await searchStandardEbooks(search)
    } else if (source === 'gutenberg') {
      results = await searchGutenberg(search)
    }

    setBooks(results)
    setLoading(false)
  }

  // Amélioration des couvertures: essayer plusieurs sources
  const getCoverUrl = async (book, title, author) => {
    // 1. Utiliser l'image fournie si elle existe
    if (book.cover) {
      try {
        const response = await axios.head(book.cover, { timeout: 3000 })
        if (response.status === 200) return book.cover
      } catch (e) {
        // Laisser vide et continuer
      }
    }

    // 2. Chercher sur Open Library par ISBN ou titre
    try {
      const olRes = await axios.get('https://openlibrary.org/search.json', {
        params: { title: title.split(' ')[0], limit: 1 },
        timeout: 3000
      })
      if (olRes.data.docs?.[0]?.cover_id) {
        return `https://covers.openlibrary.org/b/id/${olRes.data.docs[0].cover_id}-M.jpg`
      }
    } catch (e) {}

    // 3. Chercher sur Google Books
    try {
      const gbRes = await axios.get('https://www.googleapis.com/books/v1/volumes', {
        params: { q: title, maxResults: 1, key: 'AIzaSyDohZQzb4OsLe-9z1VYpG0340wWV7rIW0I' },
        timeout: 3000
      })
      if (gbRes.data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail) {
        return gbRes.data.items[0].volumeInfo.imageLinks.thumbnail.replace('&edge=curl', '')
      }
    } catch (e) {}

    // 4. Placeholder
    return PLACEHOLDER_COVER
  }

  const searchInternetArchive = async (query) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'
      const res = await axios.get(`${backendUrl}/api/search`, {
        params: { q: query, source: 'internet-archive' }
      })

      const booksWithCovers = await Promise.all(
        (res.data.results || []).slice(0, 10).map(async (book) => {
          try {
            const meta = await axios.get(`https://archive.org/metadata/${book.identifier}`)
            const files = meta.data.files || []

            const formats = {}
            const formatExt = {'.epub': 'EPUB', '.pdf': 'PDF', '.txt': 'Text', '.html': 'HTML'}

            files.forEach(f => {
              Object.entries(formatExt).forEach(([ext, label]) => {
                if (f.name.endsWith(ext) && !f.name.includes('_djvu')) {
                  formats[label] = f.name
                }
              })
            })

            if (Object.keys(formats).length === 0) return null

            const cover = `https://archive.org/services/img/${book.identifier}`
            return {
              id: `ia-${book.identifier}`,
              title: book.title,
              author: book.creator?.[0] || 'Unknown',
              cover,
              iaId: book.identifier,
              url: `https://archive.org/stream/${book.identifier}`,
              source: 'Internet Archive',
              formats
            }
          } catch (e) { return null }
        })
      )
      return booksWithCovers.filter(Boolean)
    } catch (e) {
      console.error('IA search error:', e)
      return []
    }
  }

  const searchOpenLibrary = async (query) => {
    try {
      const res = await axios.get('https://openlibrary.org/search.json', {
        params: { title: query, limit: 10 }
      })
      return (res.data.docs || []).map(book => ({
        id: `ol-${book.key}`,
        title: book.title,
        author: book.author_name?.[0] || 'Unknown',
        cover: book.cover_id ? `https://covers.openlibrary.org/b/id/${book.cover_id}-M.jpg` : PLACEHOLDER_COVER,
        iaId: book.ia?.[0],
        url: book.ia?.[0] ? `https://archive.org/stream/${book.ia[0]}` : `https://openlibrary.org${book.key}`,
        source: 'Open Library'
      }))
    } catch (e) { return [] }
  }

  const searchStandardEbooks = async (query) => {
    try {
      const res = await axios.get('https://standardebooks.org/api/books/search', {
        params: { query, limit: 10 }
      })
      return (res.data.books || []).map(book => ({
        id: `se-${book.identifier}`,
        title: book.title,
        author: book.authors[0]?.name || 'Unknown',
        cover: `https://standardebooks.org/ebooks/${book.identifier}/cover.jpg`,
        url: `https://standardebooks.org/ebooks/${book.identifier}/`,
        source: 'Standard Ebooks'
      }))
    } catch (e) { return [] }
  }

  const searchGutenberg = async (query) => {
    try {
      const res = await axios.get('https://gutendex.com/books', {
        params: { search: query }
      })
      return (res.data.results || []).map(book => {
        const htmlUrl = book.formats['text/html']
        const url = htmlUrl?.replace('cache', 'files').replace(/\.txt/, '-h.htm') ||
                   `https://www.gutenberg.org/files/${book.id}/${book.id}-h/${book.id}-h.htm`
        return {
          id: `gb-${book.id}`,
          title: book.title,
          author: book.authors[0]?.name || 'Unknown',
          cover: book.cover_image || PLACEHOLDER_COVER,
          url: url,
          source: 'Project Gutenberg'
        }
      })
    } catch (e) { return [] }
  }

  return (
    <div className="library">
      <h1>📚 Reader</h1>

      <form onSubmit={handleSearch} className="search-form">
        <div className="source-selector">
          <label>
            <input type="radio" value="all" checked={source === 'all'} onChange={(e) => setSource(e.target.value)} />
            All
          </label>
          <label>
            <input type="radio" value="internet-archive" checked={source === 'internet-archive'} onChange={(e) => setSource(e.target.value)} />
            Archive
          </label>
          <label>
            <input type="radio" value="open-library" checked={source === 'open-library'} onChange={(e) => setSource(e.target.value)} />
            OpenLib
          </label>
          <label>
            <input type="radio" value="standard-ebooks" checked={source === 'standard-ebooks'} onChange={(e) => setSource(e.target.value)} />
            StdEb
          </label>
          <label>
            <input type="radio" value="gutenberg" checked={source === 'gutenberg'} onChange={(e) => setSource(e.target.value)} />
            Guten
          </label>
        </div>
        <input
          type="text"
          placeholder="Search books..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      <div className="books-list">
        {books.length === 0 && <p className="empty">Search to find books</p>}
        {books.map(book => (
          <div
            key={book.id}
            className={`book-item ${selectedBook?.id === book.id ? 'active' : ''}`}
            onClick={() => setSelectedBook(book)}
          >
            {book.cover && <img src={book.cover} alt={book.title} />}
            <div className="book-info">
              <h3>{book.title}</h3>
              <p>{book.author}</p>
              {highlights.length > 0 && <span className="highlight-badge">{highlights.length} 🎨</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
